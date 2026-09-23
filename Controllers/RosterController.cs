using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Roster admin endpoints: assign, move, release and update players on
    /// fantasy teams, read a team roster and search players.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class RosterController : ControllerBase
    {
        private readonly RosterAdminService _rosterAdminService;

        /// <summary>
        /// Creates the controller.
        /// </summary>
        /// <param name="rosterAdminService">Service that manages fantasy team rosters.</param>
        public RosterController(RosterAdminService rosterAdminService)
        {
            _rosterAdminService = rosterAdminService;
        }

        /// <summary>
        /// Puts a player on a fantasy team for a season.
        /// </summary>
        /// <param name="request">Team, player, season and optional status, salary and slot.</param>
        /// <returns>The created roster entry, or 400 with the reason when it fails.</returns>
        [HttpPost("assign")]
        public async Task<IActionResult> AssignPlayer([FromBody] AssignPlayerRequest request)
        {
            var result = await _rosterAdminService.AssignPlayerAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Moves a player from his current fantasy team to another team.
        /// </summary>
        /// <param name="request">Player, destination team and optional season.</param>
        /// <returns>The updated roster entry, or 400 with the reason when it fails.</returns>
        [HttpPost("move")]
        public async Task<IActionResult> MovePlayer([FromBody] MovePlayerRequest request)
        {
            var result = await _rosterAdminService.MovePlayerAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Releases a player by deleting his roster entry.
        /// </summary>
        /// <param name="request">Id of the roster entry to delete.</param>
        /// <returns>The result message, or 400 with the reason when it fails.</returns>
        [HttpPost("release")]
        public async Task<IActionResult> ReleasePlayer([FromBody] ReleasePlayerRequest request)
        {
            var result = await _rosterAdminService.ReleasePlayerAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Releases every player currently assigned to a fantasy team for a season.
        /// Full league reset: every fantasy team roster becomes empty.
        /// </summary>
        /// <param name="request">Optional season id; the current season is used when omitted.</param>
        /// <returns>The result message with the number of released players.</returns>
        [HttpPost("release-all")]
        public async Task<IActionResult> ReleaseAllPlayers([FromBody] ReleaseAllPlayersRequest request)
        {
            var result = await _rosterAdminService.ReleaseAllPlayersAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Updates the status, the fantasy salary or the slot of a roster entry.
        /// </summary>
        /// <param name="request">Entry id plus the values to change.</param>
        /// <returns>The updated roster entry, or 400 with the reason when it fails.</returns>
        [HttpPost("update")]
        public async Task<IActionResult> UpdateEntry([FromBody] UpdateRosterEntryRequest request)
        {
            var result = await _rosterAdminService.UpdateEntryAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Returns the roster of one fantasy team with totals and counts.
        /// </summary>
        /// <param name="fantasyTeamId">Fantasy team id.</param>
        /// <param name="seasonId">Season id, or omitted to use the current season.</param>
        /// <returns>The team roster, or 404 when the team or season does not exist.</returns>
        [HttpGet("team/{fantasyTeamId}")]
        public async Task<IActionResult> GetTeamRoster(
            int fantasyTeamId,
            [FromQuery] int? seasonId)
        {
            var roster = await _rosterAdminService.GetTeamRosterAsync(fantasyTeamId, seasonId);

            if (roster == null)
            {
                return NotFound();
            }

            return Ok(roster);
        }

        /// <summary>
        /// Searches players by first or last name and shows who holds them.
        /// </summary>
        /// <param name="search">Text to look for in the first or last name.</param>
        /// <returns>The matching players with their current fantasy team, if any.</returns>
        [HttpGet("search")]
        public async Task<IActionResult> SearchPlayers([FromQuery] string? search)
        {
            var players = await _rosterAdminService.SearchPlayersAsync(search);

            return Ok(players);
        }
    }
}
