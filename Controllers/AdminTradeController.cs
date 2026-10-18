using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Commissioner-only trade execution: validate + apply a trade
    /// and persist the immutable audit record. Every endpoint here
    /// is gated on the Commissioner role.
    /// </summary>
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class AdminTradeController : ControllerBase
    {
        private readonly RosterAdminService _rosterAdminService;

        public AdminTradeController(RosterAdminService rosterAdminService)
        {
            _rosterAdminService = rosterAdminService;
        }

        /// <summary>
        /// Finalizes a commissioner-executed trade. The whole trade
        /// (players + picks + effective date + note) is validated
        /// and applied in one transaction, and an immutable
        /// TradeHistory snapshot is written.
        /// </summary>
        [HttpPost("finalize")]
        public async Task<IActionResult> Finalize(
            [FromBody] FinalizeTradeRequest request,
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
                .FinalizeTradeAsync(request, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Returns every recorded trade, newest first. Optional
        /// ?seasonId= scopes to a single season; when omitted the
        /// whole history is returned.
        /// </summary>
        [HttpGet("history")]
        public async Task<IActionResult> History(
      [FromQuery] int? seasonId,
      CancellationToken ct)
        {
            var rows = await _rosterAdminService
                .GetTradeHistoryAsync(seasonId, ct);

            return Ok(rows);
        }

        /// <summary>
        /// Changes a recorded trade's effective date. Updates every
        /// RosterStatusHistory row owned by that trade, updates
        /// TradeHistory.EffectiveAt, and appends a TradeDateChange
        /// audit row. Triggers a team-total recompute so scoring
        /// reflects the new date immediately.
        /// </summary>
        [HttpPatch("history/{tradeId:int}/date")]
        public async Task<IActionResult> ChangeDate(
      int tradeId,
      [FromBody] ChangeTradeDateRequest request,
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
                .ChangeTradeDateAsync(tradeId, request, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Reverts (hard-deletes) a recorded trade. Players and picks
        /// move back to their original teams, every trade-related
        /// history row is deleted, the trade is removed from the
        /// history list, and a recompute is queued so season totals
        /// are rebuilt as if the trade never happened.
        ///
        /// Refused if any traded player or pick has had downstream
        /// changes since the trade (see RevertTradeAsync for the full
        /// guard list).
        /// </summary>
        [HttpDelete("history/{tradeId:int}")]
        public async Task<IActionResult> Revert(
            int tradeId,
            CancellationToken ct)
        {
            var result = await _rosterAdminService
                .RevertTradeAsync(tradeId, ct);

            if (!result.Success)
            {
                return BadRequest(result);
            }

            return Ok(result);
        }
    }
}