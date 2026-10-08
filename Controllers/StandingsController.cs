using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StandingsController : ControllerBase
    {
        /// <summary>
        /// Standings change only during games. During a live slate,
        /// users refresh constantly; a 30-second cache turns 20 loads
        /// per minute into 2. Off-hours, nothing changes anyway.
        /// </summary>
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

        private readonly AppDbContext _dbContext;
        private readonly NhlGameLogService _nhlGameLogService;
        private readonly ResponseCacheService _cache;

        public StandingsController(
            AppDbContext dbContext,
            NhlGameLogService nhlGameLogService,
            ResponseCacheService cache)
        {
            _dbContext = dbContext;
            _nhlGameLogService = nhlGameLogService;
            _cache = cache;
        }

        [HttpGet]
        public async Task<IActionResult> GetStandings(
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            var cacheKey = seasonId.HasValue
                ? $"standings:{seasonId.Value}"
                : "standings:current";

            var rows = await _cache.GetOrCreateAsync(
                cacheKey,
                CacheTtl,
                () => BuildStandingsAsync(seasonId, ct));

            if (rows == null)
            {
                return NotFound(new
                {
                    message = seasonId.HasValue
                        ? $"Season {seasonId.Value} not found."
                        : "No season exists yet. Run POST /api/League/setup."
                });
            }

            return Ok(rows);
        }

        private async Task<List<StandingsRowDto>?> BuildStandingsAsync(
            int? seasonId,
            CancellationToken ct)
        {
            var season = seasonId.HasValue
                ? await _dbContext.Seasons
                    .FirstOrDefaultAsync(s => s.Id == seasonId.Value, ct)
                : await _dbContext.Seasons
                    .OrderByDescending(s => s.StartDate)
                    .FirstOrDefaultAsync(ct);

            if (season == null)
            {
                return null;
            }

            var rows = await _dbContext.FantasyTeamSeasons
                .Where(fts => fts.SeasonId == season.Id)
                .Include(fts => fts.FantasyTeam)
                .Select(fts => new StandingsRowDto
                {
                    FantasyTeamId = fts.FantasyTeamId,
                    FantasyTeamName = fts.FantasyTeam!.Name,

                    SkaterGamesPlayed = fts.SkaterGamesPlayed,
                    SkaterGoals = fts.SkaterGoals,
                    SkaterAssists = fts.SkaterAssists,
                    SkaterPoints = fts.SkaterPoints,
                    SkaterHatTricks = fts.SkaterHatTricks,

                    GoalieGamesPlayed = fts.GoalieGamesPlayed,
                    GoalieWins = fts.GoalieWins,
                    GoalieLosses = fts.GoalieLosses,
                    GoalieOvertimeLosses = fts.GoalieOvertimeLosses,
                    GoalieShutouts = fts.GoalieShutouts,
                    GoaliePoints = fts.GoaliePoints,

                    // Position-split fantasy points. These three columns
                    // always sum to TotalFantasyPoints; both writers
                    // preserve that invariant and log a Warning if it
                    // ever fails.
                    ForwardFantasyPoints = fts.ForwardFantasyPoints,
                    DefenseFantasyPoints = fts.DefenseFantasyPoints,
                    GoalieFantasyPoints = fts.GoalieFantasyPoints,

                    TotalFantasyPoints = fts.TotalFantasyPoints,
                    TotalFantasyPointsComputedAt =
                        fts.TotalFantasyPointsComputedAt
                })
                .ToListAsync(ct);

            // Yesterday / today totals, computed on the fly. The season
            // history is loaded once and handed to both computations.
            var seasonHistory = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h => h.SeasonId == season.Id)
                .OrderBy(h => h.EffectiveAt)
                .ThenBy(h => h.Id)
                .ToListAsync(ct);

            // The "HIER" and "AJD" columns use the fantasy date, not
            // the real ET calendar date. Between 00:00 and 03:00 ET
            // the fantasy date stays on the previous calendar day, so
            // a still-running West Coast game that started at 22:30 ET
            // continues to be counted under "Aujourd'hui" for a
            // manager watching it past midnight. At 03:00 ET the same
            // game slides to "Hier" together with the two player
            // tables on the Classement page.
            //
            // ComputeTeamDailyTotalsAsync filters PlayerGameLog rows by
            // their GameDate, which is the real ET calendar date the
            // game started on (written by NhlGameService.BuildSnapshot).
            // Passing fantasyDate as "today" here is correct because
            // the game's stored GameDate and the fantasy date coincide
            // whenever a game belongs to the currently-displayed day.
            var nowUtc = DateTime.UtcNow;
            var today = TimeZoneHelper.GetFantasyDateEt(nowUtc);
            var yesterday = today.AddDays(-1);

            var yesterdayTotals = await _nhlGameLogService
                .ComputeTeamDailyTotalsAsync(
                    season.NhlSeasonCode,
                    yesterday,
                    ct,
                    seasonHistory);

            var todayTotals = await _nhlGameLogService
                .ComputeTeamDailyTotalsAsync(
                    season.NhlSeasonCode,
                    today,
                    ct,
                    seasonHistory);

            foreach (var row in rows)
            {
                row.YesterdayFantasyPoints = yesterdayTotals
                    .GetValueOrDefault(row.FantasyTeamId);

                row.TodayFantasyPoints = todayTotals
                    .GetValueOrDefault(row.FantasyTeamId);
            }

            return rows
                .OrderByDescending(r => r.TotalFantasyPoints)
                .ThenBy(r => r.FantasyTeamName)
                .Select((r, index) =>
                {
                    r.Rank = index + 1;
                    return r;
                })
                .ToList();
        }
    }
}