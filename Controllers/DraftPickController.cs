using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
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

        /// <summary>
        /// Returns every draft pick currently owned by the given
        /// fantasy team, ordered by draft year, round and pick number.
        ///
        /// Picks that were traded away are not returned; only picks
        /// the team still holds.
        /// </summary>
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
        /// Swaps the current owner of two draft picks.
        ///
        /// Both picks must exist, must be different, and must currently
        /// belong to two different teams. Neither pick's
        /// OriginalOwnerFantasyTeamId is modified.
        ///
        /// Commissioner-only. Use this to correct a mis-recorded trade
        /// or to apply an off-platform trade by hand.
        /// </summary>
        [HttpPost("swap")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> SwapPicks(
            [FromBody] DraftPickSwapRequest request,
            CancellationToken ct)
        {
            if (request == null)
            {
                return BadRequest(new
                {
                    message = "Request body is required."
                });
            }

            if (request.PickAId <= 0 || request.PickBId <= 0)
            {
                return BadRequest(new
                {
                    message = "PickAId and PickBId are required."
                });
            }

            if (request.PickAId == request.PickBId)
            {
                return BadRequest(new
                {
                    message = "PickAId and PickBId must be different."
                });
            }

            var pickA = await _dbContext.DraftPicks
                .FirstOrDefaultAsync(p => p.Id == request.PickAId, ct);

            if (pickA == null)
            {
                return NotFound(new
                {
                    message = $"DraftPick {request.PickAId} not found."
                });
            }

            var pickB = await _dbContext.DraftPicks
                .FirstOrDefaultAsync(p => p.Id == request.PickBId, ct);

            if (pickB == null)
            {
                return NotFound(new
                {
                    message = $"DraftPick {request.PickBId} not found."
                });
            }

            if (pickA.CurrentOwnerFantasyTeamId ==
                pickB.CurrentOwnerFantasyTeamId)
            {
                return BadRequest(new
                {
                    message =
                        "Les deux choix appartiennent déjà à la même " +
                        "équipe. Choisissez un choix d'une autre équipe."
                });
            }

            var ownerA = pickA.CurrentOwnerFantasyTeamId;
            var ownerB = pickB.CurrentOwnerFantasyTeamId;

            // The actual swap. OriginalOwner fields are left alone: the
            // "came from" label on the frontend keeps pointing at the
            // original owner regardless of how many times a pick moves.
            pickA.CurrentOwnerFantasyTeamId = ownerB;
            pickB.CurrentOwnerFantasyTeamId = ownerA;

            await _dbContext.SaveChangesAsync(ct);

            // Load both team names for a readable message. Defensive
            // default on missing names so the response never throws.
            var teamNames = await _dbContext.FantasyTeams
                .AsNoTracking()
                .Where(t => t.Id == ownerA || t.Id == ownerB)
                .ToDictionaryAsync(t => t.Id, t => t.Name, ct);

            var nameA = teamNames.GetValueOrDefault(
                ownerA, $"Équipe {ownerA}");
            var nameB = teamNames.GetValueOrDefault(
                ownerB, $"Équipe {ownerB}");

            return Ok(new
            {
                message =
                    $"Choix échangés entre '{nameA}' et '{nameB}'.",
                pickAId = pickA.Id,
                pickANewOwnerFantasyTeamId = ownerB,
                pickBId = pickB.Id,
                pickBNewOwnerFantasyTeamId = ownerA
            });
        }
    }
}