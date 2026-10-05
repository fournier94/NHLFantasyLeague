using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [Authorize(Roles = AuthService.CommissionerRole)]
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
                    null,
                    ct);

            return Ok(result);
        }

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
                    null,
                    ct);

            return Ok(result);
        }

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