using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [ApiController]
    [Route("api/[controller]")]
    public class NhlGameLogController : ControllerBase
    {
        private readonly NhlGameLogService _nhlGameLogService;

        public NhlGameLogController(
NhlGameLogService nhlGameLogService)
        {
            _nhlGameLogService = nhlGameLogService;
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
        ///
        /// Use this to pull a past season, for example 20252026 for
        /// 2025-26. Returns the number of new PlayerGameLog rows written
        /// and the number of rows that already existed, so a caller can
        /// tell "the NHL API returned no games" from "the games were
        /// already saved".
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
        /// Backfills a single season of NHL game logs for every player
        /// in the database. Players who already have game-log rows for
        /// that season are skipped, so the run is safe to re-run and
        /// resumes where it left off.
        ///
        /// Default delay is 500 ms between players, matching the
        /// population batch. Override it with
        /// ?delayMsBetweenPlayers=200 for a faster (but ruder) run.
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
    }
}