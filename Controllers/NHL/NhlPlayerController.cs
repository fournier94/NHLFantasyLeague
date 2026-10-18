using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class NhlPlayerController : ControllerBase
    {
        private readonly NhlPlayerService _nhlPlayerService;
        private readonly NhlPopulationService _nhlPopulationService;
        private readonly NhlGameLogService _nhlGameLogService;
        private readonly ResponseCacheService _cache;
        private readonly ILogger<NhlPlayerController> _logger;

        public NhlPlayerController(
            NhlPlayerService nhlPlayerService,
            NhlPopulationService nhlPopulationService,
            NhlGameLogService nhlGameLogService,
            ResponseCacheService cache,
            ILogger<NhlPlayerController> logger)
        {
            _nhlPlayerService = nhlPlayerService;
            _nhlPopulationService = nhlPopulationService;
            _nhlGameLogService = nhlGameLogService;
            _cache = cache;
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

        /// <summary>
        /// Manual single-player refresh from the admin page.
        ///
        /// Fetches the NHL landing page for one player and updates
        /// his Player row (identity, team, draft, birth, headshot),
        /// his PlayerCareerStat rows, and the landing-owned columns
        /// of his current-season PlayerSeasonStat.
        ///
        /// Then, it immediately fetches his game logs for the current
        /// season to catch any missing stats (like a goalie assist
        /// that was added late by the NHL). Finally, it forces an
        /// immediate recompute of the team standings and clears the
        /// response cache so the Classement page updates instantly.
        /// </summary>
        [HttpPost("player/{id}/refresh")]
        public async Task<IActionResult> RefreshPlayer(int id)
        {
            // 1. Refresh the player's landing data (bio, draft, season totals).
            var player = await _nhlPlayerService.SavePlayerAsync(id);

            if (player == null)
            {
                return NotFound(new
                {
                    message =
                        $"Aucune donnée NHL retournée pour le NhlPlayerId " +
                        $"{id}. L'ID est peut-être invalide, ou l'API NHL " +
                        "n'a rien renvoyé pour ce joueur."
                });
            }

            // 2. Refresh the player's game logs for the current season.
            //    This catches missing stats (e.g. an assist added late).
            var seasonCode = NhlFantasyLeague.api.Constants.SeasonCodes.Current;

            try
            {
                await _nhlGameLogService.SavePlayerGameLogsAsync(
                    id,
                    seasonCode,
                    preloadedPlayer: player);

                // 3. Recompute team totals synchronously so the standings
                //    are updated before the API responds to the frontend.
                await _nhlGameLogService.RecomputeTeamSeasonTotalsAsync(
                    seasonCode,
                    CancellationToken.None);

                // 4. Clear the API caches immediately.
                _cache.Invalidate("standings:");
                _cache.Invalidate("roster:");
                _cache.Invalidate("player-detail:");
                _cache.Invalidate("player-career:");
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Failed to refresh game logs or recompute totals during single player refresh for NhlPlayerId {Id}.",
                    id);
            }

            return Ok(new
            {
                player.Id,
                player.NhlPlayerId,
                player.FirstName,
                player.LastName,
                player.Position,
                player.HeadshotUrl,
                player.NhlTeamId,
                player.PreviousNhlTeamId,
            });
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