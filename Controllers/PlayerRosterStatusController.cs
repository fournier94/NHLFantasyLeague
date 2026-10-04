using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Health;

namespace NhlFantasyLeague.api.Controllers
{
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

        [HttpPost("refresh")]
        public async Task<IActionResult> Refresh(CancellationToken ct)
        {
            var result = await _service.RefreshAsync(null, ct);

            return Ok(result);
        }

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