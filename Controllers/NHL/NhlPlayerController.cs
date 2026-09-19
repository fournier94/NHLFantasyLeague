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
    public class NhlPlayerController : ControllerBase
    {
        private readonly NhlPlayerService _nhlPlayerService;
        private readonly NhlPopulationService _nhlPopulationService;
        private readonly ILogger<NhlPlayerController> _logger;

        public NhlPlayerController(
            NhlPlayerService nhlPlayerService,
            NhlPopulationService nhlPopulationService,
            ILogger<NhlPlayerController> logger)
        {
            _nhlPlayerService = nhlPlayerService;
            _nhlPopulationService = nhlPopulationService;
            _logger = logger;
        }

        [HttpPost("populate-entire-database")]
        public async Task<IActionResult> PopulateEntireDatabase()
        {
            Console.WriteLine("========== POPULATE ENTIRE DATABASE ENDPOINT HIT ==========");

            var result =
                await _nhlPopulationService.PopulateEntirePlayerDatabaseAsync();

            return Ok(result);
        }

        [HttpPost("TEST")]
        public IActionResult TEST()
        {
            _logger.LogInformation("POPULATE ENTIRE DATABASE ENDPOINT HIT awdwadadaww");
            return Ok("========== POPULATE ENTIRE DATABASE ENDPOINT HIT ==========");
        }

        [HttpGet("TEST2")]
        public IActionResult TEST2()
        {
            return Ok("========== POPULATE ENTIRE DATABASE ENDPOINT HIT ==========");
        }

        [HttpGet("player/{id}/save")]
        public async Task<IActionResult> SavePlayer(int id)
        {
            var player = await _nhlPlayerService.SavePlayerAsync(id);

            if (player == null)
            {
                return NotFound();
            }

            return Ok(player);
        }

        [HttpGet("player/{id}/raw")]
        public async Task<IActionResult> GetPlayerRawData(int id)
        {
            var data = await _nhlPlayerService.GetPlayerRawDataAsync(id);

            return Content(data, "application/json");
        }

        [HttpGet("missing-players")]
        public async Task<IActionResult> FindMissingPlayers()
        {
            var players = await _nhlPlayerService.FindMissingPlayersAsync();

            return Ok(players);
        }

        [HttpGet("players/discover-ids")]
        public async Task<IActionResult> DiscoverPlayerIds()
        {
            var result = await _nhlPlayerService.DiscoverPlayerIdsAsync();

            return Ok(result);
        }

        [HttpGet("player/{id}/populate")]
        public async Task<IActionResult> PopulatePlayer(int id)
        {
            var player =
                await _nhlPlayerService.PopulatePlayerFromLandingAsync(id);

            if (player == null)
            {
                return NotFound();
            }

            return Ok(player);
        }

        [HttpGet("players/populate-batch")]
        public async Task<IActionResult> PopulatePlayersBatch()
        {
            var result =
                await _nhlPlayerService.PopulatePlayersFromLandingBatchAsync();

            return Ok(result);
        }

        [HttpGet("player/{id}/test-team-change/{newTeamId}")]
        public async Task<IActionResult> TestTeamChange(
int id,
int newTeamId)
        {
            var player =
                await _nhlPlayerService.TestUpdatePlayerNhlTeamAsync(
                    id,
                    newTeamId);

            if (player == null)
                return NotFound();

            return Ok(new
            {
                player.Id,
                player.NhlPlayerId,
                player.FirstName,
                player.LastName,
                player.NhlTeamId,
                player.PreviousNhlTeamId
            });
        }
    }
}