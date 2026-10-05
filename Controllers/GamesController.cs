using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Jobs;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Game Day endpoints. Serves today's schedule and boxscores from
    /// the in-memory cache (no DB), and exposes manual triggers for
    /// each scheduled job (commissioner-only, used for debugging and
    /// recovery).
    ///
    /// All endpoints require authentication (inherited from the global
    /// AuthorizeFilter in Program.cs). The manual triggers further
    /// require the Commissioner role.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class GamesController : ControllerBase
    {
        /// <summary>
        /// How old the cache can be before IsFresh flips to false.
        /// The scheduled live refresh runs every 7 minutes, so 10
        /// minutes means "we missed at most one tick".
        /// </summary>
        private static readonly TimeSpan CacheFreshnessWindow =
            TimeSpan.FromMinutes(10);

        private readonly LiveGameCache _cache;
        private readonly ScheduledJobsRunner _runner;

        public GamesController(
            LiveGameCache cache,
            ScheduledJobsRunner runner)
        {
            _cache = cache;
            _runner = runner;
        }

        // =================================================================
        // Read endpoints — served from the in-memory cache, no DB
        // =================================================================

        [HttpGet("today")]
        public async Task<IActionResult> GetToday(
            [FromQuery] bool refresh = false,
            CancellationToken ct = default)
        {
            if (refresh)
            {
                await _runner.RunLiveRefreshAsync(ct);
            }

            var snapshots = _cache.GetAll();

            var response = new GameDayScheduleResponse
            {
                LastRefreshUtc = _cache.LastRefreshUtc == DateTime.MinValue
                    ? null
                    : _cache.LastRefreshUtc,
                IsFresh = _cache.IsFresh(CacheFreshnessWindow),
                Games = snapshots
                    .Select(s => new GameDayGameSummary
                    {
                        GameId = s.GameId,
                        GameDate = s.GameDate,
                        StartTimeUtc = s.StartTimeUtc,
                        GameState = s.GameState,
                        AwayAbbreviation = s.AwayAbbreviation,
                        HomeAbbreviation = s.HomeAbbreviation,
                        AwayScore = s.AwayScore,
                        HomeScore = s.HomeScore,
                        PeriodNumber = s.PeriodNumber,
                        PeriodType = s.PeriodType,
                        HasBoxscore = s.Boxscore != null,
                    })
                    .ToList(),
            };

            return Ok(response);
        }

        [HttpGet("{gameId:long}/boxscore")]
        public IActionResult GetBoxscore(long gameId)
        {
            var snapshot = _cache.Get(gameId);

            if (snapshot == null)
            {
                return NotFound(new
                {
                    message = $"Game {gameId} is not in the live cache."
                });
            }

            if (snapshot.Boxscore == null)
            {
                return NotFound(new
                {
                    message = $"Game {gameId} has no cached boxscore yet. " +
                              "Try again once the game is live or has finished."
                });
            }

            return Ok(snapshot.Boxscore);
        }

        // =================================================================
        // Manual triggers — commissioner only, used for debugging
        // =================================================================

        /// <summary>
        /// Runs the live refresh job immediately. Updates the in-memory
        /// cache. Does not touch the database.
        /// </summary>
        [HttpPost("refresh-live")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshLive(CancellationToken ct)
        {
            await _runner.RunLiveRefreshAsync(ct);

            return Ok(new
            {
                message = "Live refresh completed.",
                lastRefreshUtc = _cache.LastRefreshUtc,
                gameCount = _cache.GetAll().Count,
            });
        }

        /// <summary>
        /// Runs the daily refresh job immediately (ESPN injuries +
        /// NHL/AHL roster locations).
        /// </summary>
        [HttpPost("refresh-daily")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshDaily(CancellationToken ct)
        {
            await _runner.RunDailyRefreshAsync(ct);

            return Ok(new
            {
                message = "Daily refresh completed.",
            });
        }

        /// <summary>
        /// Runs the post-game write job immediately for a specific ET
        /// date. Idempotent: running it twice for the same date
        /// produces the same state.
        ///
        /// Omit ?date to target yesterday in ET.
        /// </summary>
        [HttpPost("refresh-post-game")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshPostGame(
            [FromQuery] DateOnly? date,
            CancellationToken ct)
        {
            var targetDateOnly = date ?? DateOnly.FromDateTime(
                TimeZoneHelper
                    .ToEastern(DateTime.UtcNow)
                    .AddDays(-1));

            await _runner.RunPostGameWriteAsync(targetDateOnly, ct);

            return Ok(new
            {
                message = "Post-game write completed.",
                date = targetDateOnly,
            });
        }

        /// <summary>
        /// Runs the career stats refresh immediately for a specific ET
        /// date. Refreshes landing data (career table, bio, draft info,
        /// current-season totals) for every player who appeared in a
        /// game on that date.
        ///
        /// Omit ?date to target yesterday in ET.
        /// </summary>
        [HttpPost("refresh-career-stats")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshCareerStats(
            [FromQuery] DateOnly? date,
            CancellationToken ct)
        {
            var targetDateOnly = date ?? DateOnly.FromDateTime(
                TimeZoneHelper
                    .ToEastern(DateTime.UtcNow)
                    .AddDays(-1));

            await _runner.RunCareerStatsRefreshAsync(targetDateOnly, ct);

            return Ok(new
            {
                message = "Career stats refresh completed.",
                date = targetDateOnly,
            });
        }

        /// <summary>
        /// Runs the weekly deep refresh job immediately (teams, player
        /// population, full team-total recompute).
        /// </summary>
        [HttpPost("refresh-weekly")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshWeekly(CancellationToken ct)
        {
            await _runner.RunWeeklyRefreshAsync(ct);

            return Ok(new
            {
                message = "Weekly deep refresh completed.",
            });
        }

        /// <summary>
        /// Runs a full FantasyTeamSeason recompute immediately for the
        /// current season. Same code path as the on-demand recompute
        /// triggered by roster changes, but callable on demand.
        ///
        /// Useful after manual DB edits, or when you want to force
        /// standings to refresh without waiting for the next tick.
        /// </summary>
        [HttpPost("recompute")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> Recompute(CancellationToken ct)
        {
            await _runner.RunRecomputeAsync(ct);

            return Ok(new
            {
                message = "Recompute completed.",
            });
        }
    }
}