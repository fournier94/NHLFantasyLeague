using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Roster admin endpoints: assign, move, release and update players on
    /// fantasy teams, read a team roster and search players.
    ///
    /// Mutations (assign / move / release / release-all / update / swap /
    /// set-status / backfill / history edit / history delete) are
    /// commissioner-only. Reads (team roster, search, status history) are
    /// available to any authenticated user.
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
        [Authorize(Roles = AuthService.CommissionerRole)]
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
        [Authorize(Roles = AuthService.CommissionerRole)]
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
        [Authorize(Roles = AuthService.CommissionerRole)]
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
        [Authorize(Roles = AuthService.CommissionerRole)]
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
        [Authorize(Roles = AuthService.CommissionerRole)]
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

        /// <summary>
        /// Atomically swaps the RosterStatus of two players on the same
        /// fantasy team at the same effective instant. Enforces same
        /// position group and the exact league shape
        /// (12/6/1 active + 4/2/1 bench + 3 prospects).
        /// </summary>
        /// <param name="request">Team, the two players, the effective instant and an optional note.</param>
        /// <returns>The swap result, or 400 with the reason when it fails.</returns>
        [HttpPost("swap-status")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> SwapRosterStatus([FromBody] SwapRosterStatusRequest request)
        {
            var result = await _rosterAdminService.SwapRosterStatusAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Sets a single player's RosterStatus. Escape hatch used for
        /// corrections and manual adjustments where a swap is not
        /// applicable. Still enforces the league shape.
        /// </summary>
        /// <param name="request">Team, player, new status, effective instant and an optional note.</param>
        /// <returns>The update result, or 400 with the reason when it fails.</returns>
        [HttpPost("set-status")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> SetRosterStatus([FromBody] SetRosterStatusRequest request)
        {
            var result = await _rosterAdminService.SetRosterStatusAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Returns the append-only RosterStatusHistory of one player for
        /// one season, most recent first.
        /// </summary>
        /// <param name="playerId">Player id (Player.Id).</param>
        /// <param name="seasonId">Season id, or omitted to use the current season.</param>
        /// <returns>The history rows.</returns>
        [HttpGet("status-history/{playerId}")]
        public async Task<IActionResult> GetRosterStatusHistory(
            int playerId,
            [FromQuery] int? seasonId)
        {
            var history = await _rosterAdminService
                .GetRosterStatusHistoryAsync(playerId, seasonId);

            return Ok(history);
        }

        /// <summary>
        /// One-time seed that writes a history row per current RosterEntry
        /// for a season, so existing rosters have a baseline before any
        /// real swap happens. Safe to re-run: entries that already have
        /// any history row for the season are skipped.
        /// </summary>
        /// <param name="request">Season id (optional) and the effective instant.</param>
        /// <returns>The number of history rows inserted.</returns>
        [HttpPost("backfill-status-history")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> BackfillStatusHistory([FromBody] BackfillStatusHistoryRequest request)
        {
            var result = await _rosterAdminService
                .BackfillStatusHistoryAsync(request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Corrects the EffectiveAt of a history row in place. Sibling
        /// rows that share the current EffectiveAt (e.g. the two rows
        /// written by a trade) are moved together.
        /// </summary>
        /// <param name="id">History row id.</param>
        /// <param name="request">The new effective instant and an optional note.</param>
        [HttpPatch("status-history/{id}")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> UpdateStatusHistory(
            int id,
            [FromBody] UpdateRosterStatusHistoryRequest request)
        {
            var result = await _rosterAdminService
                .UpdateStatusHistoryAsync(id, request);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Deletes a history row. Sibling rows sharing the same
        /// (PlayerId, SeasonId, EffectiveAt) are deleted together.
        /// </summary>
        /// <param name="id">History row id.</param>
        [HttpDelete("status-history/{id}")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> DeleteStatusHistory(int id)
        {
            var result = await _rosterAdminService
                .DeleteStatusHistoryAsync(id);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }
    }
}