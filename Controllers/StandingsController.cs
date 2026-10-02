using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Season standings. Read-only: every number is written by the
    /// recompute step of POST /api/NhlGameLog/season/{season}/refresh-all
    /// (and by POST .../recompute-team-totals). This controller never
    /// computes anything on the fly.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class StandingsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;

        public StandingsController(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /// <summary>
        /// Returns every fantasy team's season aggregate, sorted by
        /// TotalFantasyPoints descending. Ties are broken by team name
        /// (alphabetical) so the order is deterministic.
        /// </summary>
        /// <param name="seasonId">
        /// Database id of the season. Optional: the current season (the
        /// one with the latest StartDate) is used when omitted.
        /// </param>
        [HttpGet]
        public async Task<IActionResult> GetStandings(
            [FromQuery] int? seasonId)
        {
            var season = seasonId.HasValue
                ? await _dbContext.Seasons
                    .FirstOrDefaultAsync(s => s.Id == seasonId.Value)
                : await _dbContext.Seasons
                    .OrderByDescending(s => s.StartDate)
                    .FirstOrDefaultAsync();

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
                .ToListAsync();

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