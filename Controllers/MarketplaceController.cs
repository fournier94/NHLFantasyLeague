using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Marketplace: trade offers between fantasy managers.
    ///
    /// All endpoints require authentication (inherited from the global
    /// AuthorizeFilter in Program.cs). They use the authenticated user
    /// to resolve the fantasy team, so a client can never create an
    /// offer on behalf of another manager.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class MarketplaceController : ControllerBase
    {
        private readonly MarketplaceService _marketplaceService;
        private readonly UserManager<ApplicationUser> _userManager;

        public MarketplaceController(
            MarketplaceService marketplaceService,
            UserManager<ApplicationUser> userManager)
        {
            _marketplaceService = marketplaceService;
            _userManager = userManager;
        }

        [HttpPost("offers")]
        public async Task<IActionResult> CreateOffer(
            [FromBody] CreateTradeOfferRequest request,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .CreateOfferAsync(uid, request, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(result.Offer);
        }

        [HttpGet("offers")]
        public async Task<IActionResult> ListOffers(
            [FromQuery] bool includeMine = false,
            CancellationToken ct = default)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var offers = await _marketplaceService
                .ListActiveOffersAsync(uid, includeMine, ct);

            return Ok(offers);
        }

        /// <summary>
        /// Records that the calling user has seen the given offers.
        /// Called by the browse tab after the list has been on screen
        /// for a short grace period.
        /// </summary>
        [HttpPost("offers/mark-seen")]
        public async Task<IActionResult> MarkOffersSeen(
            [FromBody] MarkOffersSeenRequest request,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var inserted = await _marketplaceService
                .MarkOffersSeenAsync(
                    uid,
                    request.OfferIds ?? new List<int>(),
                    ct);

            return Ok(new { inserted });
        }

        /// <summary>
        /// Replaces the slots and note of an existing offer owned by
        /// the calling user's team. Refused when the offer already has
        /// a Pending or Accepted response, since changing the demanded
        /// players underneath a responder would invalidate their
        /// picks.
        /// </summary>
        [HttpPut("offers/{id:int}")]
        public async Task<IActionResult> UpdateOffer(
            int id,
            [FromBody] CreateTradeOfferRequest request,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .UpdateOfferAsync(uid, id, request, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(result.Offer);
        }

        [HttpDelete("offers/{id:int}")]
        public async Task<IActionResult> CancelOffer(
            int id,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .CancelOfferAsync(uid, id, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(new { message = result.Message });
        }

        /// <summary>
        /// Responds to another manager's offer. Every slot of the
        /// offer must be filled with a player from the responding
        /// manager's roster, matching the slot's demanded position
        /// group.
        /// </summary>
        [HttpPost("offers/{id:int}/respond")]
        public async Task<IActionResult> RespondToOffer(
            int id,
            [FromBody] RespondToTradeOfferRequest request,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .RespondToOfferAsync(uid, id, request, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(result);
        }

        /// <summary>
        /// Creates a direct trade offer from the calling user's team
        /// to the given target team. Both sides of the exchange are
        /// already specified in the request.
        ///
        /// Creates a TradeOffer owned by the target team plus a
        /// TradeOfferResponse from the calling user's team in a
        /// single transaction, so the proposal lands in the target
        /// manager's "Offres reçues" ready to be accepted or
        /// rejected, and in the calling user's "Offres envoyées"
        /// ready to be cancelled.
        ///
        /// Used by the "Créer" tab of the Marketplace.
        /// </summary>
        [HttpPost("direct-offers")]
        public async Task<IActionResult> CreateDirectOffer(
            [FromBody] CreateDirectOfferRequest request,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .CreateDirectOfferAsync(uid, request, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(result);
        }

        /// <summary>
        /// Lists every Pending response to a still-active offer that
        /// the calling user created. This is the "Offres reçues"
        /// section.
        /// </summary>
        [HttpGet("responses")]
        public async Task<IActionResult> ListReceivedResponses(
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var responses = await _marketplaceService
                .ListReceivedResponsesAsync(uid, ct);

            return Ok(responses);
        }

        /// <summary>
        /// Lists every Pending response the calling user's team has
        /// sent to someone else's still-active offer. This is the
        /// "Offres envoyées" section.
        /// </summary>
        [HttpGet("responses/sent")]
        public async Task<IActionResult> ListSentResponses(
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var responses = await _marketplaceService
                .ListSentResponsesAsync(uid, ct);

            return Ok(responses);
        }

        /// <summary>
        /// Records that the calling user has seen the given responses
        /// on his Reçues tab. Idempotent. Called by the received tab
        /// after the list has been on screen for a short grace
        /// period, mirroring the browse tab's mark-seen flow.
        /// </summary>
        [HttpPost("responses/mark-seen")]
        public async Task<IActionResult> MarkResponsesSeen(
            [FromBody] MarkResponsesSeenRequest request,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var inserted = await _marketplaceService
                .MarkResponsesSeenAsync(
                    uid,
                    request.ResponseIds ?? new List<int>(),
                    ct);

            return Ok(new { inserted });
        }

        /// <summary>
        /// Returns the navbar notification count for the calling
        /// user: how many offers he has not yet seen on the browse
        /// tab, and how many responses on his own offers he has not
        /// yet seen on the received tab. Polled by the SPA every
        /// 60 seconds. The Total is what the badge renders.
        /// </summary>
        [HttpGet("notifications/count")]
        public async Task<IActionResult> GetNotificationCount(
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var count = await _marketplaceService
                .GetNotificationCountAsync(uid, ct);

            return Ok(count);
        }

        /// <summary>
        /// Accepts a Pending response to one of the calling user's own
        /// offers. Pure state change: no player is moved, no roster
        /// row is touched.
        /// </summary>
        [HttpPost("responses/{id:int}/accept")]
        public async Task<IActionResult> AcceptResponse(
            int id,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .AcceptOfferResponseAsync(uid, id, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(new { message = result.Message });
        }

        /// <summary>
        /// Cancels a Pending response that the calling user's team
        /// sent to someone else's offer. The original offer stays
        /// Active — only this response is withdrawn.
        /// </summary>
        [HttpPost("responses/{id:int}/cancel")]
        public async Task<IActionResult> CancelResponse(
            int id,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .CancelOfferResponseAsync(uid, id, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(new { message = result.Message });
        }

        /// <summary>
        /// Refuses a Pending response to one of the calling user's own
        /// offers. Deletes the entire TradeOffer, which cascades to
        /// every response and every "seen" marker tied to it.
        /// </summary>
        [HttpPost("responses/{id:int}/reject")]
        public async Task<IActionResult> RejectResponse(
            int id,
            CancellationToken ct)
        {
            var userId = _userManager.GetUserId(User);

            if (!int.TryParse(userId, out var uid))
            {
                return Unauthorized();
            }

            var result = await _marketplaceService
                .RejectOfferResponseAsync(uid, id, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(new { message = result.Message });
        }

        // -----------------------------------------------------------------
        // Admin: accepted trades awaiting manual player swaps
        // -----------------------------------------------------------------

        /// <summary>
        /// Commissioner-only. Lists every accepted response across the
        /// league, newest first, with both sides of every slot
        /// populated so the commissioner knows which players to move.
        /// </summary>
        [Authorize(Roles = AuthService.CommissionerRole)]
        [HttpGet("admin/accepted-trades")]
        public async Task<IActionResult> ListAcceptedTrades(
            CancellationToken ct)
        {
            var trades = await _marketplaceService
                .ListAcceptedTradesAsync(ct);

            return Ok(trades);
        }

        /// <summary>
        /// Commissioner-only. Deletes the TradeOffer that owns the
        /// given accepted response. Cascades to every response and
        /// every "seen" marker tied to that offer, so the trade
        /// disappears from every section it was visible in.
        /// </summary>
        [Authorize(Roles = AuthService.CommissionerRole)]
        [HttpDelete("admin/accepted-trades/{responseId:int}")]
        public async Task<IActionResult> DeleteAcceptedTrade(
            int responseId,
            CancellationToken ct)
        {
            var result = await _marketplaceService
                .AdminDeleteAcceptedTradeAsync(responseId, ct);

            if (!result.Success)
            {
                return BadRequest(new { message = result.Message });
            }

            return Ok(new { message = result.Message });
        }
    }
}