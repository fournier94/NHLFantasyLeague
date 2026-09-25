using Microsoft.AspNetCore.Mvc;
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

        /// <summary>
        /// Returns every row of a player's career history: every season,
        /// every league, every game type, one row per Sequence. Source for
        /// the player detail page.
        /// </summary>
        [HttpGet("player/{id}/career-stats")]
        public async Task<IActionResult> GetCareerStats(int id)
        {
            var stats = await _nhlStatsService.GetPlayerCareerStatsAsync(id);

            if (stats == null)
            {
                return NotFound();
            }

            return Ok(stats);
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