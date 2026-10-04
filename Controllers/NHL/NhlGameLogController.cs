using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [AllowAnonymous]
    [ApiController]
    [Route("api/[controller]")]
    public class NhlGameLogController : ControllerBase
    {
        private readonly NhlGameLogService _nhlGameLogService;
        private readonly NhlStatsService _nhlStatsService;

        public NhlGameLogController(
NhlGameLogService nhlGameLogService,
NhlStatsService nhlStatsService)
        {
            _nhlGameLogService = nhlGameLogService;
            _nhlStatsService = nhlStatsService;
        }

        [HttpGet("player/{id}/game-log/{season}")]
        public async Task<IActionResult> GetPlayerGameLog(
int id,
int season)
        {
            var gameLog = await _nhlGameLogService.GetPlayerGameLogAsync(id, season);

            if (gameLog == null)
            {
                return NotFound();
            }

            return Ok(gameLog);
        }

        [HttpGet("player/{id}/game-log/{season}/save")]
        public async Task<IActionResult> SavePlayerGameLogs(
int id,
int season)
        {
            var savedCount =
                await _nhlGameLogService.SavePlayerGameLogsAsync(id, season);

            return Ok(new
            {
                PlayerId = id,
                Season = season,
                NewGamesSaved = savedCount
            });
        }

        /// <summary>
        /// Backfills every game log for a player and one season, then
        /// recomputes his PlayerSeasonStat (FantasyPoints + HatTricks).
        /// </summary>
        [HttpGet("player/{id}/game-log/{season}/backfill")]
        public async Task<IActionResult> BackfillPlayerGameLogs(
int id,
int season)
        {
            var savedCount =
                await _nhlGameLogService.SavePlayerGameLogsAsync(id, season);

            var totalInDb = await _nhlGameLogService
                .CountPlayerGameLogsAsync(id, season);

            return Ok(new
            {
                PlayerId = id,
                Season = season,
                NewGamesSaved = savedCount,
                TotalGamesInDb = totalInDb
            });
        }

        /// <summary>
        /// Backfills a single season of NHL game logs for every player in
        /// the database. Players who already have game-log rows for that
        /// season are skipped, so the run is safe to re-run and resumes
        /// where it left off. Default delay: 500 ms between players.
        /// </summary>
        [HttpPost("season/{season}/backfill-all")]
        public async Task<IActionResult> BackfillAllPlayersGameLogs(
            int season,
            [FromQuery] int delayMsBetweenPlayers = 500,
            CancellationToken ct = default)
        {
            if (delayMsBetweenPlayers < 0)
            {
                delayMsBetweenPlayers = 0;
            }

            var result =
                await _nhlGameLogService.BackfillAllPlayersGameLogsAsync(
                    season,
                    delayMsBetweenPlayers,
                    ct);

            return Ok(result);
        }

        /// <summary>
        /// Refreshes the current season's regular-season game logs for
        /// every player in the database and recomputes their
        /// PlayerSeasonStat row for that season.
        ///
        /// Idempotent: re-running this never creates duplicate game logs
        /// (the upsert is keyed on NhlGameId) and never creates duplicate
        /// season-stat rows (keyed on PlayerId + SeasonId).
        ///
        /// Call it as often as you want during the season. Existing games
        /// are refreshed, new games are appended, and the season totals
        /// are recomputed from the full set of logs.
        ///
        /// Default delay: 500 ms between players.
        /// </summary>
        [HttpPost("season/{season}/refresh-all")]
        public async Task<IActionResult> RefreshCurrentSeasonForAllPlayers(
      int season,
      [FromQuery] int delayMsBetweenPlayers = 500,
      [FromQuery] int skip = 0,
      [FromQuery] int take = 0,
      CancellationToken ct = default)
        {
            if (delayMsBetweenPlayers < 0)
            {
                delayMsBetweenPlayers = 0;
            }

            if (skip < 0) skip = 0;
            if (take < 0) take = 0;

            var result =
                await _nhlGameLogService.RefreshCurrentSeasonForAllPlayersAsync(
                    season,
                    delayMsBetweenPlayers,
                    skip,
                    take,
                    ct);

            return Ok(result);
        }

        /// <summary>
        /// Backfills the hat-trick count on every NHL PlayerCareerStat row
        /// in the database, by fetching the NHL game log for each
        /// (player, season, game type) triple and counting the games with
        /// 3+ goals. Does NOT write any PlayerGameLog rows.
        ///
        /// Rows already computed are skipped. Pass ?force=true to
        /// recompute them. Default delay: 500 ms between API calls.
        /// </summary>
        [HttpPost("career-hat-tricks/backfill-all")]
        public async Task<IActionResult> BackfillCareerHatTricks(
       [FromQuery] int delayMsBetweenCalls = 500,
       [FromQuery] bool force = false,
       CancellationToken ct = default)
        {
            if (delayMsBetweenCalls < 0)
            {
                delayMsBetweenCalls = 0;
            }

            var result =
                await _nhlStatsService.BackfillCareerHatTricksAsync(
                    delayMsBetweenCalls,
                    force,
                    ct);

            return Ok(result);
        }

        /// <summary>
        /// Recomputes every fantasy team's season total from scratch,
        /// using the season's PlayerGameLog rows and the append-only
        /// RosterStatusHistory. Does not fetch anything from the NHL
        /// API. Safe to call as often as you want.
        ///
        /// Called automatically at the end of
        /// POST /api/NhlGameLog/season/{season}/refresh-all; this
        /// endpoint is the standalone trigger.
        /// </summary>
        [HttpPost("season/{season}/recompute-team-totals")]
        public async Task<IActionResult> RecomputeTeamTotals(
            int season,
            CancellationToken ct = default)
        {
            var result =
                await _nhlGameLogService.RecomputeTeamSeasonTotalsAsync(
                    season,
                    ct);

            return Ok(result);
        }
    }
}