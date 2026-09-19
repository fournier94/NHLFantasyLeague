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
    public class NhlTeamController : ControllerBase
    {
        private readonly NhlTeamService _nhlTeamService;

        public NhlTeamController(
            NhlTeamService nhlTeamService)
        {
            _nhlTeamService = nhlTeamService;
        }

        [HttpGet("teams/sync")]
        public async Task<IActionResult> SyncTeams()
        {
            var teams = await _nhlTeamService.SyncTeamsAsync();

            return Ok(teams);
        }

        [HttpGet("roster/{team}")]
        public async Task<IActionResult> GetRoster(string team)
        {
            var roster = await _nhlTeamService.GetRosterAsync(team);

            if (roster == null)
            {
                return NotFound();
            }

            return Ok(roster);
        }

        [HttpGet("players/sync")]
        public async Task<IActionResult> SyncPlayers()
        {
            var result = await _nhlTeamService.SyncPlayersAsync();

            return Ok(result);
        }
    }
}
