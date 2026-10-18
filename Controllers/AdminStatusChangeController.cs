using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Commissioner-only batch status change management.
    /// </summary>
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class AdminStatusChangeController : ControllerBase
    {
        private readonly RosterAdminService _rosterAdminService;

        public AdminStatusChangeController(
            RosterAdminService rosterAdminService)
        {
            _rosterAdminService = rosterAdminService;
        }

        [HttpPost("finalize")]
        public async Task<IActionResult> Finalize(
            [FromBody] FinalizeStatusChangeRequest request,
            CancellationToken ct)
        {
            if (request == null)
            {
                return BadRequest(new
                {
                    message = "Request body is required."
                });
            }

            var result = await _rosterAdminService
                .FinalizeStatusChangeAsync(request, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        [HttpGet("history")]
        public async Task<IActionResult> History(
            [FromQuery] int? seasonId,
            CancellationToken ct)
        {
            var rows = await _rosterAdminService
                .GetStatusChangeHistoryAsync(seasonId, ct);

            return Ok(rows);
        }

        [HttpPatch("history/{id:int}/date")]
        public async Task<IActionResult> ChangeDate(
            int id,
            [FromBody] ChangeStatusChangeDateRequest request,
            CancellationToken ct)
        {
            if (request == null)
            {
                return BadRequest(new
                {
                    message = "Request body is required."
                });
            }

            var result = await _rosterAdminService
                .ChangeStatusChangeDateAsync(id, request, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        [HttpDelete("history/{id:int}")]
        public async Task<IActionResult> Revert(
            int id,
            CancellationToken ct)
        {
            var result = await _rosterAdminService
                .RevertStatusChangeAsync(id, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }
    }
}