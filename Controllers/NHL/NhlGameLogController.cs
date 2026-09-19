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
    }
}
