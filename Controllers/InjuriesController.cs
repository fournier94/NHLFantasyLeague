using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Read-only view of every injured or suspended player in the
    /// league. Data comes straight from the Player row (written by
    /// the daily NhlInjuryService refresh); this controller never
    /// writes anything.
    ///
    /// Result is cached for 60 seconds in memory. The underlying data
    /// only changes once per day (daily refresh), so a stale-minute
    /// window is fine and keeps a busy injuries page from waking
    /// Neon on every visit.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class InjuriesController : ControllerBase
    {
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);

        private readonly AppDbContext _dbContext;
        private readonly Services.Cache.ResponseCacheService _cache;

        public InjuriesController(
            AppDbContext dbContext,
            Services.Cache.ResponseCacheService cache)
        {
            _dbContext = dbContext;
            _cache = cache;
        }

        /// <summary>
        /// Returns every injured or suspended player.
        ///
        /// Optional filters (all applied in memory after the bulk
        /// read, so the DB query itself is one query):
        ///   - search      : substring on first or last name
        ///   - nhlTeam     : 3-letter NHL team abbreviation
        ///   - fantasyTeamId : only players currently held by that fantasy team
        ///   - kind        : "Injury" or "Suspension" (default: all)
        /// </summary>
        [HttpGet]
        public async Task<IActionResult> GetInjuries(
            [FromQuery] string? search,
            [FromQuery] string? nhlTeam,
            [FromQuery] int? fantasyTeamId,
            [FromQuery] string? kind,
            CancellationToken ct)
        {
            var cacheKey =
                $"injuries:{search ?? "_"}:{nhlTeam ?? "_"}:" +
                $"{fantasyTeamId?.ToString() ?? "_"}:{kind ?? "_"}";

            var rows = await _cache.GetOrCreateAsync(
                cacheKey,
                CacheTtl,
                () => BuildInjuriesAsync(search, nhlTeam, fantasyTeamId, kind, ct));

            return Ok(rows);
        }

        private async Task<List<InjuryRowDto>> BuildInjuriesAsync(
            string? search,
            string? nhlTeam,
            int? fantasyTeamId,
            string? kind,
            CancellationToken ct)
        {
            // One bulk read of every injured player. The injured set
            // is small (~100 rows in-season), so filtering in memory
            // is cheaper than adding SQL clauses per combination.
            var players = await _dbContext.Players
                .AsNoTracking()
                .Include(p => p.NhlTeam)
                .Where(p => p.IsInjured)
                .ToListAsync(ct);

            if (players.Count == 0)
            {
                return new List<InjuryRowDto>();
            }

            // Current-season roster lookup, one query, used to attach
            // fantasy-team info without N+1.
            var currentSeason = await _dbContext.Seasons
                .AsNoTracking()
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync(ct);

            var rosterLookup = new Dictionary<int, RosterEntry>();

            if (currentSeason != null)
            {
                var entries = await _dbContext.RosterEntries
                    .AsNoTracking()
                    .Include(e => e.FantasyTeam)
                    .Where(e => e.SeasonId == currentSeason.Id)
                    .ToListAsync(ct);

                foreach (var entry in entries)
                {
                    rosterLookup[entry.PlayerId] = entry;
                }
            }

            // ---- In-memory filters ------------------------------------

            IEnumerable<Player> filtered = players;

            if (!string.IsNullOrWhiteSpace(search))
            {
                var s = search.Trim().ToLowerInvariant();

                filtered = filtered.Where(p =>
                    p.FirstName.ToLowerInvariant().Contains(s) ||
                    p.LastName.ToLowerInvariant().Contains(s));
            }

            if (!string.IsNullOrWhiteSpace(nhlTeam))
            {
                var t = nhlTeam.Trim();

                filtered = filtered.Where(p =>
                    string.Equals(
                        p.NhlTeam?.Abbreviation,
                        t,
                        StringComparison.OrdinalIgnoreCase));
            }

            if (fantasyTeamId.HasValue)
            {
                filtered = filtered.Where(p =>
                    rosterLookup.TryGetValue(p.Id, out var e) &&
                    e.FantasyTeamId == fantasyTeamId.Value);
            }

            if (!string.IsNullOrWhiteSpace(kind))
            {
                if (Enum.TryParse<InjuryKind>(kind, ignoreCase: true, out var parsed))
                {
                    filtered = filtered.Where(p => p.InjuryKind == parsed);
                }
            }

            // ---- Projection -------------------------------------------

            return filtered
                .OrderBy(p => p.LastName)
                .ThenBy(p => p.FirstName)
                .Select(p =>
                {
                    rosterLookup.TryGetValue(p.Id, out var entry);

                    return new InjuryRowDto
                    {
                        PlayerId = p.Id,
                        NhlPlayerId = p.NhlPlayerId,
                        FirstName = p.FirstName,
                        LastName = p.LastName,
                        Position = p.Position,
                        NhlTeamAbbreviation = p.NhlTeam?.Abbreviation,
                        NhlTeamName = p.NhlTeam?.Name,
                        HeadshotUrl = p.HeadshotUrl,

                        IsInjured = p.IsInjured,
                        InjuryStatus = p.InjuryStatus,
                        InjuryKind = p.InjuryKind.ToString(),
                        InjuryShortDescription = p.InjuryShortDescription,
                        InjuryLongDescription = p.InjuryLongDescription,
                        InjuryType = p.InjuryType,
                        InjuryDetail = p.InjuryDetail,
                        InjurySide = p.InjurySide,
                        InjuryReturnDate = p.InjuryReturnDate,
                        InjuryFantasyStatus = p.InjuryFantasyStatus,
                        InjuryUpdatedAt = p.InjuryUpdatedAt,

                        FantasyTeamId = entry?.FantasyTeamId,
                        FantasyTeamName = entry?.FantasyTeam?.Name,
                        RosterStatus = entry?.RosterStatus.ToString(),
                    };
                })
                .ToList();
        }
    }
}