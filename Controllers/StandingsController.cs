using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class StandingsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly NhlGameLogService _nhlGameLogService;

        public StandingsController(
            AppDbContext dbContext,
            NhlGameLogService nhlGameLogService)
        {
            _dbContext = dbContext;
            _nhlGameLogService = nhlGameLogService;
        }

        [HttpGet]
        public async Task<IActionResult> GetStandings(
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            var season = seasonId.HasValue
                ? await _dbContext.Seasons
                    .FirstOrDefaultAsync(s => s.Id == seasonId.Value, ct)
                : await _dbContext.Seasons
                    .OrderByDescending(s => s.StartDate)
                    .FirstOrDefaultAsync(ct);

            if (season == null)
            {
                return NotFound(new
                {
                    message = seasonId.HasValue
                        ? $"Season {seasonId.Value} not found."
                        : "No season exists yet. Run POST /api/League/setup."
                });
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

                    TotalFantasyPoints = fts.TotalFantasyPoints,
                    TotalFantasyPointsComputedAt = fts.TotalFantasyPointsComputedAt
                })
                .ToListAsync(ct);

            // Yesterday / today totals, computed on the fly. UTC
            // calendar days to match the PlayerGameLog.GameDate
            // convention used everywhere else.
            //
            // Load the whole season's RosterStatusHistories ONCE and
            // hand it to both computations. Without this, the service
            // would fetch the same ~2,000 rows from Neon twice.
            var seasonHistory = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h => h.SeasonId == season.Id)
                .OrderBy(h => h.EffectiveAt)
                .ThenBy(h => h.Id)
                .ToListAsync(ct);

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
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

            var ranked = rows
                .OrderByDescending(r => r.TotalFantasyPoints)
                .ThenBy(r => r.FantasyTeamName)
                .Select((r, index) =>
                {
                    r.Rank = index + 1;
                    return r;
                })
                .ToList();

            return Ok(ranked);
        }
    }
}