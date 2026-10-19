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
    /// Read endpoints (browse offers, notification count, mark seen)
    /// are public so an anonymous reviewer can browse the market.
    /// Mutations (create / cancel / respond / accept / reject) still
    /// require authentication and, where applicable, team ownership.
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

        /// <summary>
        /// Parses the calling user's numeric id from the auth claims,
        /// or returns null when the caller is anonymous. Used by the
        /// public GET endpoints below.
        /// </summary>
        private int? TryGetUserId()
        {
            var id = _userManager.GetUserId(User);

            if (!string.IsNullOrEmpty(id) &&
                int.TryParse(id, out var parsed))
            {
                return parsed;
            }

            return null;
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

        [AllowAnonymous]
        [HttpGet("offers")]
        public async Task<IActionResult> ListOffers(
            [FromQuery] bool includeMine = false,
            CancellationToken ct = default)
        {
            var uid = TryGetUserId();

            // Anonymous visitors have no "mine" to include. Coerce so
            // the service does not build a query that cannot match
            // any row.
            var effectiveIncludeMine = uid.HasValue && includeMine;

            var offers = await _marketplaceService
                .ListActiveOffersAsync(uid, effectiveIncludeMine, ct);

            return Ok(offers);
        }

        [AllowAnonymous]
        [HttpPost("offers/mark-seen")]
        public async Task<IActionResult> MarkOffersSeen(
            [FromBody] MarkOffersSeenRequest request,
            CancellationToken ct)
        {
            var uid = TryGetUserId();

            if (!uid.HasValue)
            {
                // No-op for anonymous. The browse panel fires this on
                // every mount; short-circuit before touching the DB.
                return Ok(new { inserted = 0 });
            }

            var inserted = await _marketplaceService
                .MarkOffersSeenAsync(
                    uid.Value,
                    request.OfferIds ?? new List<int>(),
                    ct);

            return Ok(new { inserted });
        }

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

        [AllowAnonymous]
        [HttpGet("notifications/count")]
        public async Task<IActionResult> GetNotificationCount(
            CancellationToken ct)
        {
            var uid = TryGetUserId();

            var count = await _marketplaceService
                .GetNotificationCountAsync(uid, ct);

            return Ok(count);
        }

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

        [Authorize(Roles = AuthService.CommissionerRole)]
        [HttpGet("admin/accepted-trades")]
        public async Task<IActionResult> ListAcceptedTrades(
            CancellationToken ct)
        {
            var trades = await _marketplaceService
                .ListAcceptedTradesAsync(ct);

            return Ok(trades);
        }

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