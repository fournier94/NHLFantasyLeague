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
        private readonly NhlGameService _gameService;

        public GamesController(
            LiveGameCache cache,
            ScheduledJobsRunner runner,
            NhlGameService gameService)
        {
            _cache = cache;
            _runner = runner;
            _gameService = gameService;
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

            var nowUtc = DateTime.UtcNow;

            var response = new GameDayScheduleResponse
            {
                LastRefreshUtc = _cache.LastRefreshUtc == DateTime.MinValue
                    ? null
                    : _cache.LastRefreshUtc,
                IsFresh = _cache.IsFresh(CacheFreshnessWindow),

                // Two "today" values:
                //   - CurrentFantasyDate  : what the "Aujourd'hui" /
                //                           "Hier" columns should
                //                           show. Applies the 3 AM
                //                           ET cutoff.
                //   - CurrentEtDate       : the real ET calendar
                //                           date, no cutoff.
                CurrentFantasyDate = TimeZoneHelper.GetFantasyDateEt(nowUtc),
                CurrentEtDate = TimeZoneHelper.GetNhlGameDateEt(nowUtc),

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
        public async Task<IActionResult> GetBoxscore(
      long gameId,
      CancellationToken ct = default)
        {
            // Try the in-memory live cache first. It has today's
            // games with the freshest data.
            var snapshot = _cache.Get(gameId);

            if (snapshot?.Boxscore != null)
            {
                return Ok(snapshot.Boxscore);
            }

            // Fall back to fetching from the NHL API directly. This
            // handles historical games (any day before today) and
            // today's games whose boxscore has not been cached yet.
            try
            {
                var box = await _gameService.GetBoxscoreAsync(gameId, ct);

                if (box == null)
                {
                    return NotFound(new
                    {
                        message = $"Game {gameId} boxscore is not available."
                    });
                }

                return Ok(box);
            }
            catch (Exception ex)
            {
                return NotFound(new
                {
                    message = $"Game {gameId} boxscore could not be fetched.",
                    detail = $"{ex.GetType().Name}: {ex.Message}"
                });
            }
        }

        /// <summary>
        /// Returns the schedule for a specific NHL calendar date
        /// (yyyy-MM-dd, ET). Used by the Game Day date picker to show
        /// the last 7 days of games.
        ///
        /// The validation window is [fantasyDate - 6, fantasyDate],
        /// where fantasyDate is the backend's current fantasy date
        /// (real ET calendar date, with the 3 AM ET cutoff). This is
        /// exactly the seven dates the frontend's date picker offers,
        /// so a user cannot request a date the UI would never show
        /// and cannot be rejected for a date the UI does show.
        ///
        /// Between 00:00 and 03:00 ET, fantasyDate is the previous ET
        /// calendar date, so the window shifts back by a day in the
        /// same window the picker does.
        /// </summary>
        [HttpGet("by-date/{date}")]
        public async Task<IActionResult> GetByDate(
            string date,
            CancellationToken ct = default)
        {
            if (!DateOnly.TryParseExact(
                    date,
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsed))
            {
                return BadRequest(new
                {
                    message = "Date must be in yyyy-MM-dd format."
                });
            }

            var nowUtc = DateTime.UtcNow;
            var fantasyDate = TimeZoneHelper.GetFantasyDateEt(nowUtc);
            var minDate = fantasyDate.AddDays(-6);

            if (parsed < minDate || parsed > fantasyDate)
            {
                return BadRequest(new
                {
                    message = "Date must be within the last 7 days."
                });
            }

            var schedule = await _gameService
                .GetScheduleForDateAsync(parsed, ct);

            var games = schedule
                .Select(g => new GameDayGameSummary
                {
                    GameId = g.Id,
                    GameDate = g.GameDate,
                    StartTimeUtc = g.StartTimeUtc,
                    GameState = g.GameState,
                    AwayAbbreviation = g.AwayTeam.Abbreviation,
                    HomeAbbreviation = g.HomeTeam.Abbreviation,
                    AwayScore = g.AwayTeam.Score,
                    HomeScore = g.HomeTeam.Score,
                    PeriodNumber = g.PeriodDescriptor?.Number,
                    PeriodType = g.PeriodDescriptor?.PeriodType,
                    // Any state other than FUT / PRE means a boxscore
                    // can be fetched on demand from the NHL API.
                    HasBoxscore =
                        !string.Equals(
                            g.GameState, "FUT",
                            StringComparison.OrdinalIgnoreCase) &&
                        !string.Equals(
                            g.GameState, "PRE",
                            StringComparison.OrdinalIgnoreCase),
                })
                .ToList();

            var response = new GameDayScheduleResponse
            {
                LastRefreshUtc = nowUtc,
                IsFresh = true,

                // Same two date fields as GetToday, so a frontend that
                // renders the date picker and the Ajd/Hier columns
                // from one response shape does not need to branch on
                // which endpoint produced it.
                CurrentFantasyDate = fantasyDate,
                CurrentEtDate = TimeZoneHelper.GetNhlGameDateEt(nowUtc),

                Games = games,
            };

            return Ok(response);
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
        /// Omit ?date to target yesterday in real ET, which is the ET
        /// calendar date of the most recently completed NHL slate.
        /// This is the right default for a commissioner who wants to
        /// re-run the write for the games that just ended, regardless
        /// of whether the current instant is inside the 3 AM fantasy
        /// cutoff window. The fantasy date is a display concept and
        /// is deliberately not used here.
        /// </summary>
        [HttpPost("refresh-post-game")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshPostGame(
            [FromQuery] DateOnly? date,
            CancellationToken ct)
        {
            var targetDateOnly = date ?? TimeZoneHelper
                .GetNhlGameDateEt(DateTime.UtcNow)
                .AddDays(-1);

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
        /// Omit ?date to target yesterday in real ET, matching the
        /// post-game write default and for the same reason.
        /// </summary>
        [HttpPost("refresh-career-stats")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshCareerStats(
            [FromQuery] DateOnly? date,
            CancellationToken ct)
        {
            var targetDateOnly = date ?? TimeZoneHelper
                .GetNhlGameDateEt(DateTime.UtcNow)
                .AddDays(-1);

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