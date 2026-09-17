using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services;

namespace NhlFantasyLeague.api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class NhlTestController : ControllerBase
    {
        private readonly NhlApiService _nhlApiService;

        public NhlTestController(NhlApiService nhlApiService)
        {
            _nhlApiService = nhlApiService;
        }

        [HttpGet("player/{id}/save")]
        public async Task<IActionResult> SavePlayer(int id)
        {
            var player = await _nhlApiService.SavePlayerAsync(id);

            if (player == null)
            {
                return NotFound();
            }

            return Ok(player);
        }

        [HttpGet("teams/sync")]
        public async Task<IActionResult> SyncTeams()
        {
            var teams = await _nhlApiService.SyncTeamsAsync();

            return Ok(teams);
        }

        [HttpGet("roster/{team}")]
        public async Task<IActionResult> GetRoster(string team)
        {
            var roster = await _nhlApiService.GetRosterAsync(team);

            if (roster == null)
            {
                return NotFound();
            }

            return Ok(roster);
        }

        [HttpGet("players/sync")]
        public async Task<IActionResult> SyncPlayers()
        {
            var result = await _nhlApiService.SyncPlayersAsync();

            return Ok(result);
        }

        [HttpGet("player/{id}/raw")]
        public async Task<IActionResult> GetPlayerRawData(int id)
        {
            var data = await _nhlApiService.GetPlayerRawDataAsync(id);

            return Content(data, "application/json");
        }

        [HttpGet("player/{id}/game-log/{season}")]
        public async Task<IActionResult> GetPlayerGameLog(
    int id,
    int season)
        {
            var gameLog = await _nhlApiService.GetPlayerGameLogAsync(id, season);

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
                await _nhlApiService.SavePlayerGameLogsAsync(id, season);

            return Ok(new
            {
                PlayerId = id,
                Season = season,
                NewGamesSaved = savedCount
            });
        }

        [HttpGet("player/{id}/season-stats/{season}/update")]
        public async Task<IActionResult> UpdatePlayerSeasonStats(
    int id,
    int season)
        {
            await _nhlApiService.UpdatePlayerSeasonStatsAsync(
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
            var player = await _nhlApiService.GetPlayerAsync(id);

            if (player == null)
            {
                return NotFound();
            }

            var stats = await _nhlApiService.GetPlayerSeasonStatsAsync(
                id,
                season);

            if (stats == null)
            {
                return NotFound();
            }

            return Ok(stats);
        }

        [HttpGet("missing-players")]
        public async Task<IActionResult> FindMissingPlayers()
        {
            var players = await _nhlApiService.FindMissingPlayersAsync();

            return Ok(players);
        }

        [HttpGet("players/discover-ids")]
        public async Task<IActionResult> DiscoverPlayerIds()
        {
            var result = await _nhlApiService.DiscoverPlayerIdsAsync();

            return Ok(result);
        }

        [HttpGet("player/{id}/populate")]
        public async Task<IActionResult> PopulatePlayer(int id)
        {
            var player =
                await _nhlApiService.PopulatePlayerFromLandingAsync(id);

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
                await _nhlApiService.PopulatePlayersFromLandingBatchAsync();

            return Ok(result);
        }

        [HttpGet("player/{id}/career-stats/sync")]
        public async Task<IActionResult> SyncPlayerCareerStats(int id)
        {
            var stats =
                await _nhlApiService.SyncPlayerCareerStatsAsync(id);

            if (stats.Count == 0)
            {
                return NotFound();
            }

            return Ok(stats);
        }

        [HttpGet("capfreeze/test-cap-hits")]
        public IActionResult TestCapHits()
        {
            var capHits =
                _nhlApiService.TestExtractCapHitsFromRow();

            return Ok(capHits);
        }

        [HttpGet("capfreeze/test-forwards")]
        public async Task<IActionResult> TestCapFreezeForwards()
        {
            var html =
                await _nhlApiService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _nhlApiService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Forwards");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-defense")]
        public async Task<IActionResult> TestCapFreezeDefense()
        {
            var html =
                await _nhlApiService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _nhlApiService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Defense");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-goalies")]
        public async Task<IActionResult> TestCapFreezeGoalies()
        {
            var html =
                await _nhlApiService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _nhlApiService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Goalies");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-minors")]
        public async Task<IActionResult> TestCapFreezeMinors()
        {
            var html =
                await _nhlApiService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _nhlApiService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Non-Roster / Minors");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-rfas")]
        public async Task<IActionResult> TestCapFreezeRfas()
        {
            var html =
                await _nhlApiService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _nhlApiService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Unsigned RFAs");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-dead-cap")]
        public async Task<IActionResult> TestCapFreezeDeadCap()
        {
            var html =
                await _nhlApiService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _nhlApiService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Dead Cap");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-alias-match")]
        public async Task<IActionResult> TestCapFreezeAliasMatch(
    [FromQuery] string name)
        {
            var player =
                await _nhlApiService.FindPlayerByCapFreezeNameAsync(name);

            if (player == null)
                return NotFound();

            return Ok(new
            {
                player.Id,
                player.NhlPlayerId,
                player.FirstName,
                player.LastName,
                player.CapFreezeName
            });
        }

        [HttpGet("capfreeze/test-team-player-matches")]
        public async Task<IActionResult> TestTeamPlayerMatches(
    [FromQuery] string name,
    [FromQuery] int nhlTeamId)
        {
            var result =
                await _nhlApiService.TestFindTeamPlayerMatchesAsync(
                    name,
                    nhlTeamId);

            return Content(
                result,
                "application/json");
        }
    }
}