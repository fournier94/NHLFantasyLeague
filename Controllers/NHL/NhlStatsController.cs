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
    public class NhlStatsController : ControllerBase
    {
        private readonly NhlPlayerService _nhlPlayerService;
        private readonly NhlStatsService _nhlStatsService;

        public NhlStatsController(
    NhlPlayerService nhlPlayerService,
    NhlStatsService nhlStatsService)
        {
            _nhlPlayerService = nhlPlayerService;
            _nhlStatsService = nhlStatsService;
        }

        [HttpGet("player/{id}/season-stats/{season}/update")]
        public async Task<IActionResult> UpdatePlayerSeasonStats(
int id,
int season)
        {
            await _nhlStatsService.UpdatePlayerSeasonStatsAsync(
                id,
                season);

            return Ok(new
            {
                PlayerId = id,
                Season = season,
                Message = "Season statistics updated successfully."
            });
        }

        [HttpGet("player/{id}/season-stats/{season}")]
        public async Task<IActionResult> GetPlayerSeasonStats(
int id,
int season)
        {
            var player = await _nhlPlayerService.GetPlayerAsync(id);

            if (player == null)
            {
                return NotFound();
            }

            var stats = await _nhlStatsService.GetPlayerSeasonStatsAsync(
                id,
                season);

            if (stats == null)
            {
                return NotFound();
            }

            return Ok(stats);
        }

        [HttpGet("player/{id}/career-stats/sync")]
        public async Task<IActionResult> SyncPlayerCareerStats(int id)
        {
            var stats =
                await _nhlStatsService.SyncPlayerCareerStatsAsync(id);

            if (stats.Count == 0)
            {
                return NotFound();
            }

            return Ok(stats);
        }
    }
}
