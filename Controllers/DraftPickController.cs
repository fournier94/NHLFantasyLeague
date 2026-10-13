using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Draft pick endpoints.
    ///
    /// Read endpoints are available to any authenticated user.
    /// Mutations are commissioner-only.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class DraftPickController : ControllerBase
    {
        private readonly AppDbContext _dbContext;

        public DraftPickController(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        [HttpGet("team/{fantasyTeamId:int}")]
        public async Task<IActionResult> GetTeamDraftPicks(
            int fantasyTeamId,
            CancellationToken ct)
        {
            var teamExists = await _dbContext.FantasyTeams
                .AsNoTracking()
                .AnyAsync(t => t.Id == fantasyTeamId, ct);

            if (!teamExists)
            {
                return NotFound(new
                {
                    message = $"Fantasy team {fantasyTeamId} not found."
                });
            }

            var picks = await _dbContext.DraftPicks
                .AsNoTracking()
                .Include(p => p.Draft)
                    .ThenInclude(d => d.Season)
                .Include(p => p.OriginalOwnerFantasyTeam)
                .Where(p => p.CurrentOwnerFantasyTeamId == fantasyTeamId)
                .OrderBy(p => p.Draft.Season.NhlSeasonCode)
                .ThenBy(p => p.Round)
                .ThenBy(p => p.PickNumber)
                .ToListAsync(ct);

            var result = picks
                .Select(p => new DraftPickDto
                {
                    Id = p.Id,
                    DraftId = p.DraftId,
                    DraftYear = p.Draft.Season.NhlSeasonCode / 10000,
                    NhlSeasonCode = p.Draft.Season.NhlSeasonCode,
                    SeasonName = p.Draft.Season.Name,
                    Round = p.Round,
                    PickNumber = p.PickNumber,
                    OriginalOwnerFantasyTeamId =
                        p.OriginalOwnerFantasyTeamId,
                    OriginalOwnerFantasyTeamName =
                        p.OriginalOwnerFantasyTeam?.Name
                        ?? string.Empty,
                    CurrentOwnerFantasyTeamId =
                        p.CurrentOwnerFantasyTeamId,
                    IsOriginallyOwned =
                        p.OriginalOwnerFantasyTeamId ==
                        p.CurrentOwnerFantasyTeamId,
                })
                .ToList();

            return Ok(result);
        }

        /// <summary>
        /// Transfers one draft pick from its current owner to another
        /// team. Only the pick's CurrentOwnerFantasyTeamId is
        /// rewritten; the OriginalOwnerFantasyTeamId is left alone
        /// so the "came from" label keeps its full history.
        ///
        /// Also cleans up any marketplace object that the transfer
        /// invalidates: an active offer, a pending/accepted response
        /// that offered this pick, or a pending/accepted response
        /// that requested this pick from its old owner. All are now
        /// stale because the old owner no longer holds the pick.
        /// Those objects are deleted in the same transaction as the
        /// transfer, matching the policy used when a player changes
        /// teams.
        ///
        /// Commissioner-only.
        /// </summary>
        [HttpPost("transfer")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> TransferPick(
            [FromBody] DraftPickTransferRequest request,
            CancellationToken ct)
        {
            if (request == null)
            {
                return BadRequest(new
                {
                    message = "Request body is required."
                });
            }

            if (request.PickId <= 0)
            {
                return BadRequest(new
                {
                    message = "PickId is required."
                });
            }

            if (request.NewOwnerFantasyTeamId <= 0)
            {
                return BadRequest(new
                {
                    message = "NewOwnerFantasyTeamId is required."
                });
            }

            var pick = await _dbContext.DraftPicks
                .Include(p => p.Draft)
                    .ThenInclude(d => d.Season)
                .FirstOrDefaultAsync(p => p.Id == request.PickId, ct);

            if (pick == null)
            {
                return NotFound(new
                {
                    message = $"DraftPick {request.PickId} not found."
                });
            }

            if (pick.CurrentOwnerFantasyTeamId ==
                request.NewOwnerFantasyTeamId)
            {
                return BadRequest(new
                {
                    message =
                        "Ce choix appartient déjà à l'équipe de " +
                        "destination."
                });
            }

            var newOwner = await _dbContext.FantasyTeams
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    t => t.Id == request.NewOwnerFantasyTeamId, ct);

            if (newOwner == null)
            {
                return NotFound(new
                {
                    message =
                        $"Fantasy team {request.NewOwnerFantasyTeamId} " +
                        "not found."
                });
            }

            var oldOwnerId = pick.CurrentOwnerFantasyTeamId;

            var oldOwner = await _dbContext.FantasyTeams
                .AsNoTracking()
                .FirstOrDefaultAsync(t => t.Id == oldOwnerId, ct);

            var oldOwnerName = oldOwner?.Name
                ?? $"Équipe {oldOwnerId}";

            var (offersDeleted, responsesDeleted) =
                await DeleteMarketplaceObjectsForPickAsync(
                    oldOwnerId,
                    pick.Id,
                    ct);

            pick.CurrentOwnerFantasyTeamId = newOwner.Id;

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new
            {
                message =
                    $"Choix {pick.Draft.Season.Name} — Ronde {pick.Round}, " +
                    $"Choix {pick.PickNumber} transféré de " +
                    $"'{oldOwnerName}' à '{newOwner.Name}'." +
                    BuildMarketplaceCleanupSuffix(
                        offersDeleted, responsesDeleted),
                pickId = pick.Id,
                newOwnerFantasyTeamId = newOwner.Id,
            });
        }

        /// <summary>
        /// Deletes every marketplace object that references the given
        /// pick on the given (old owner's) side.
        ///
        /// Three passes, all against the old owner:
        ///
        ///   1. Every ACTIVE TradeOffer created by the old owner that
        ///      advertises this pick on its creator side.
        ///
        ///   2. Every PENDING or ACCEPTED TradeOfferResponse created
        ///      by the old owner that offers this pick on its
        ///      responder side, restricted to offers NOT being
        ///      deleted in pass 1 (their responses cascade).
        ///
        ///   3. Every PENDING or ACCEPTED TradeOfferResponse on an
        ///      offer created by the old owner that has this pick in
        ///      its RequestedPicks, restricted to offers NOT being
        ///      deleted in pass 1. The old owner can no longer
        ///      deliver a pick that has been requested from him.
        ///
        /// Non-active offers and resolved/cancelled responses are
        /// left in place: they are already invisible and deleting
        /// them would erase audit rows for no benefit.
        ///
        /// Does NOT call SaveChangesAsync. Caller saves.
        /// </summary>
        private async Task<(int OffersDeleted, int ResponsesDeleted)>
            DeleteMarketplaceObjectsForPickAsync(
                int oldOwnerTeamId,
                int draftPickId,
                CancellationToken ct)
        {
            var offerIdsToDelete = await _dbContext.TradeOfferPicks
                .AsNoTracking()
                .Where(p =>
                    p.DraftPickId == draftPickId &&
                    p.TradeOffer.CreatedByFantasyTeamId ==
                        oldOwnerTeamId &&
                    p.TradeOffer.Status == TradeOfferStatus.Active)
                .Select(p => p.TradeOfferId)
                .Distinct()
                .ToListAsync(ct);

            if (offerIdsToDelete.Count > 0)
            {
                var offersToDelete = await _dbContext.TradeOffers
                    .Where(o => offerIdsToDelete.Contains(o.Id))
                    .ToListAsync(ct);

                _dbContext.TradeOffers.RemoveRange(offersToDelete);
            }

            // Pass 2: the old owner's responses that offered this pick.
            var respondingIdsToDelete = await _dbContext
                .TradeOfferResponsePicks
                .AsNoTracking()
                .Where(p =>
                    p.DraftPickId == draftPickId &&
                    p.TradeOfferResponse.RespondingFantasyTeamId ==
                        oldOwnerTeamId &&
                    (p.TradeOfferResponse.Status ==
                        TradeOfferResponseStatus.Pending ||
                     p.TradeOfferResponse.Status ==
                        TradeOfferResponseStatus.Accepted) &&
                    !offerIdsToDelete.Contains(
                        p.TradeOfferResponse.TradeOfferId))
                .Select(p => p.TradeOfferResponseId)
                .Distinct()
                .ToListAsync(ct);

            // Pass 3: responses on the old owner's offers that
            // requested this pick from him.
            var requestedIdsToDelete = await _dbContext
                .TradeOfferResponseRequestedPicks
                .AsNoTracking()
                .Where(p =>
                    p.DraftPickId == draftPickId &&
                    p.TradeOfferResponse.TradeOffer
                        .CreatedByFantasyTeamId == oldOwnerTeamId &&
                    (p.TradeOfferResponse.Status ==
                        TradeOfferResponseStatus.Pending ||
                     p.TradeOfferResponse.Status ==
                        TradeOfferResponseStatus.Accepted) &&
                    !offerIdsToDelete.Contains(
                        p.TradeOfferResponse.TradeOfferId))
                .Select(p => p.TradeOfferResponseId)
                .Distinct()
                .ToListAsync(ct);

            var allResponseIds = respondingIdsToDelete
                .Concat(requestedIdsToDelete)
                .Distinct()
                .ToList();

            if (allResponseIds.Count > 0)
            {
                var responsesToDelete = await _dbContext
                    .TradeOfferResponses
                    .Where(r => allResponseIds.Contains(r.Id))
                    .ToListAsync(ct);

                _dbContext.TradeOfferResponses.RemoveRange(
                    responsesToDelete);
            }

            return (
                offerIdsToDelete.Count,
                allResponseIds.Count);
        }

        private static string BuildMarketplaceCleanupSuffix(
            int offersDeleted,
            int responsesDeleted)
        {
            if (offersDeleted == 0 && responsesDeleted == 0)
            {
                return string.Empty;
            }

            var parts = new List<string>();

            if (offersDeleted > 0)
            {
                parts.Add($"{offersDeleted} offre(s)");
            }

            if (responsesDeleted > 0)
            {
                parts.Add($"{responsesDeleted} réponse(s)");
            }

            return
                " Marché : " +
                string.Join(" et ", parts) +
                " utilisant ce choix ont été supprimées.";
        }
    }
}