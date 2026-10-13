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
        /// Transfers one draft pick from its current owner to another
        /// team. Only the pick's CurrentOwnerFantasyTeamId is rewritten;
        /// the OriginalOwnerFantasyTeamId is left alone so the
        /// "came from" label keeps its full history.
        ///
        /// Refuses when:
        ///   - the pick does not exist,
        ///   - the destination team does not exist,
        ///   - the destination team is already the current owner.
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

            var oldOwner = await _dbContext.FantasyTeams
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    t => t.Id == pick.CurrentOwnerFantasyTeamId, ct);

            var oldOwnerName = oldOwner?.Name
                ?? $"Équipe {pick.CurrentOwnerFantasyTeamId}";

            pick.CurrentOwnerFantasyTeamId = newOwner.Id;

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new
            {
                message =
                    $"Choix {pick.Draft.Season.Name} — Ronde {pick.Round}, " +
                    $"Choix {pick.PickNumber} transféré de " +
                    $"'{oldOwnerName}' à '{newOwner.Name}'.",
                pickId = pick.Id,
                newOwnerFantasyTeamId = newOwner.Id,
            });
        }
    }
}