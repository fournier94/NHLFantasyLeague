using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services;

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
    }
}