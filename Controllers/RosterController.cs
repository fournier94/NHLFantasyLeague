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
    /// Mutations are commissioner-only. The public read endpoints
    /// (team roster, ownership, game stats for date, search) are
    /// available to any visitor so anonymous reviewers can browse
    /// Mon équipe, Classement, and the marketplace.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class RosterController : ControllerBase
    {
        private readonly RosterAdminService _rosterAdminService;

        public RosterController(RosterAdminService rosterAdminService)
        {
            _rosterAdminService = rosterAdminService;
        }

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

        [AllowAnonymous]
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

        [HttpGet("team/{fantasyTeamId:int}/at-date")]
        public async Task<IActionResult> GetTeamRosterAtDate(
            int fantasyTeamId,
            [FromQuery] string date,
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            if (!DateOnly.TryParseExact(
                    date,
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsed))
            {
                return BadRequest(new
                {
                    message = "Date must be in yyyy-MM-dd format."
                });
            }

            var roster = await _rosterAdminService
                .GetTeamRosterAtDateAsync(
                    fantasyTeamId, parsed, seasonId, ct);

            if (roster == null)
            {
                return NotFound();
            }

            return Ok(roster);
        }

        [AllowAnonymous]
        [HttpGet("search")]
        public async Task<IActionResult> SearchPlayers([FromQuery] string? search)
        {
            var players = await _rosterAdminService.SearchPlayersAsync(search);

            return Ok(players);
        }

        [AllowAnonymous]
        [HttpGet("ownership")]
        public async Task<IActionResult> GetOwnership(
            [FromQuery] int[] nhlPlayerIds,
            CancellationToken ct = default)
        {
            var rows = await _rosterAdminService
                .GetPlayerOwnershipAsync(
                    nhlPlayerIds ?? Array.Empty<int>(),
                    ct);

            return Ok(rows);
        }

        [AllowAnonymous]
        [HttpGet("game-stats-for-date")]
        public async Task<IActionResult> GetGameStatsForDate(
            [FromQuery] int fantasyTeamId,
            [FromQuery] string date,
            CancellationToken ct = default)
        {
            if (!DateOnly.TryParseExact(
                    date,
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsed))
            {
                return BadRequest(new
                {
                    message = "Date must be in yyyy-MM-dd format."
                });
            }

            var rows = await _rosterAdminService
                .GetRosterGameStatsForDateAsync(
                    fantasyTeamId, parsed, ct);

            return Ok(rows);
        }

        [HttpGet("team/{fantasyTeamId}/active-game-logs")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> GetActiveGameLogs(
            int fantasyTeamId,
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            var rows = await _rosterAdminService
                .GetActiveGameLogsForTeamAsync(
                    fantasyTeamId, seasonId, ct);

            return Ok(rows);
        }

        [HttpGet("team/{fantasyTeamId:int}/effective-roster")]
        public async Task<IActionResult> GetEffectiveRoster(
            int fantasyTeamId,
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            var roster = await _rosterAdminService
                .GetEffectiveRosterAsync(fantasyTeamId, seasonId, ct);

            if (roster == null)
            {
                return NotFound();
            }

            return Ok(roster);
        }

        [HttpGet("shape-violations")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> GetShapeViolations(
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            var violations = await _rosterAdminService
                .FindRosterShapeViolationsAsync(seasonId, ct);

            return Ok(violations);
        }

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

        [HttpGet("status-history/{playerId}")]
        public async Task<IActionResult> GetRosterStatusHistory(
            int playerId,
            [FromQuery] int? seasonId)
        {
            var history = await _rosterAdminService
                .GetRosterStatusHistoryAsync(playerId, seasonId);

            return Ok(history);
        }

        [HttpGet("status-history/{playerId}/all")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> GetPlayerFullStatusHistory(
            int playerId,
            CancellationToken ct = default)
        {
            var history = await _rosterAdminService
                .GetPlayerFullStatusHistoryAsync(playerId, ct);

            return Ok(history);
        }

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

        [HttpPost("player/{playerId:int}/reset-fantasy-history")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> ResetPlayerFantasyHistory(
            int playerId,
            [FromQuery] int? seasonId,
            CancellationToken ct = default)
        {
            var result = await _rosterAdminService
                .ResetPlayerFantasyHistoryAsync(playerId, seasonId, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }
    }
}