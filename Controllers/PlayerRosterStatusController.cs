using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Health;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Manual triggers and reads for the player roster-status feature.
    /// Commissioner-only: the refresh hits the NHL and AHL feeds for
    /// every team, which is not something a regular user should be
    /// able to launch.
    /// </summary>
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class PlayerRosterStatusController : ControllerBase
    {
        private readonly PlayerRosterStatusService _service;
        private readonly AppDbContext _dbContext;

        public PlayerRosterStatusController(
            PlayerRosterStatusService service,
            AppDbContext dbContext)
        {
            _service = service;
            _dbContext = dbContext;
        }

        /// <summary>
        /// Runs a full roster-status refresh. Returns a summary of what
        /// was found and how many players landed in each location.
        ///
        /// When PlayerStatus:Enabled is false, this returns immediately
        /// with a "feature disabled" message. That is intentional: the
        /// pipeline can be exercised from Swagger once, and then turned
        /// off until the scheduled jobs exist.
        /// </summary>
        [HttpPost("refresh")]
        public async Task<IActionResult> Refresh(CancellationToken ct)
        {
            var result = await _service.RefreshAsync(ct);

            return Ok(result);
        }

        /// <summary>
        /// Returns the current RosterLocation for one player, keyed by
        /// NhlPlayerId. Used by Swagger for spot-checking after a
        /// refresh, and (later) by the player page.
        /// </summary>
        [HttpGet("player/{nhlPlayerId:int}")]
        public async Task<IActionResult> GetPlayerRosterStatus(
            int nhlPlayerId,
            CancellationToken ct)
        {
            var player = await _dbContext.Players
                .AsNoTracking()
                .Where(p => p.NhlPlayerId == nhlPlayerId)
                .Select(p => new
                {
                    p.Id,
                    p.NhlPlayerId,
                    p.FirstName,
                    p.LastName,
                    p.Position,
                    p.NhlTeamId,
                    p.IsInjured,
                    p.InjuryStatus,
                    p.InjuryKind,
                    RosterLocation = p.RosterLocation.HasValue
                        ? p.RosterLocation.Value.ToString()
                        : null,
                    p.RosterLocationUpdatedAt
                })
                .FirstOrDefaultAsync(ct);

            if (player == null)
            {
                return NotFound(new
                {
                    message =
                        $"No player with NhlPlayerId {nhlPlayerId} exists."
                });
            }

            return Ok(player);
        }

        /// <summary>
        /// Returns counts of players per RosterLocation. Cheap summary
        /// for a quick sanity check after a refresh.
        /// </summary>
        [HttpGet("summary")]
        public async Task<IActionResult> GetSummary(CancellationToken ct)
        {
            var rows = await _dbContext.Players
                .AsNoTracking()
                .Where(p => p.RosterLocation != null)
                .GroupBy(p => p.RosterLocation)
                .Select(g => new
                {
                    Location = g.Key!.Value.ToString(),
                    Count = g.Count()
                })
                .ToListAsync(ct);

            var neverScanned = await _dbContext.Players
                .AsNoTracking()
                .CountAsync(p => p.RosterLocation == null, ct);

            return Ok(new
            {
                ByLocation = rows,
                NeverScanned = neverScanned
            });
        }
    }
}