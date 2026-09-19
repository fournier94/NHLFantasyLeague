using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.CapFreeze
{
    [ApiController]
    [Route("api/[controller]")]
    public class CapFreezeMatchingController : ControllerBase
    {
        private readonly CapFreezeMatchingService _capFreezeMatchingService;

        public CapFreezeMatchingController(
CapFreezeMatchingService capFreezeMatchingService)
        {
            _capFreezeMatchingService = capFreezeMatchingService;
        }

        [HttpGet("capfreeze/test-alias-match")]
        public async Task<IActionResult> TestCapFreezeAliasMatch(
[FromQuery] string name)
        {
            var player =
                await _capFreezeMatchingService.FindPlayerByCapFreezeNameAsync(name);

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
                await _capFreezeMatchingService.TestFindTeamPlayerMatchesAsync(
                    name,
                    nhlTeamId);

            return Content(
                result,
                "application/json");
        }

        [HttpGet("capfreeze/test-record-match")]
        public async Task<IActionResult> TestRecordCapFreezeMatch(
[FromQuery] string name,
[FromQuery] int nhlTeamId)
        {
            var result =
                await _capFreezeMatchingService.TestCapFreezeMatchPathAsync(
                    name,
                    nhlTeamId);

            if (result == null)
                return NotFound();

            return Ok(result);
        }

        [HttpGet("capfreeze/test-production-match")]
        public async Task<IActionResult> TestProductionCapFreezeMatch(
[FromQuery] string name,
[FromQuery] string position,
[FromQuery] int nhlTeamId)
        {
            var player =
                await _capFreezeMatchingService.FindAndRecordCapFreezePlayerMatchAsync(
                    name,
                    position,
                    nhlTeamId);

            if (player == null)
                return NotFound();

            return Ok(new
            {
                player.Id,
                player.NhlPlayerId,
                player.FirstName,
                player.LastName,
                player.NhlTeamId,
                player.PreviousNhlTeamId,
                player.CapFreezeName,
                player.Position
            });
        }
    }
}
