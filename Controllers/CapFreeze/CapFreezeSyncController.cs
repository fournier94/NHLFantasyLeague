using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.CapFreeze
{
    [ApiController]
    [Route("api/[controller]")]
    public class CapFreezeSyncController : ControllerBase
    {
        private readonly CapFreezeSyncService _capFreezeSyncService;
        private readonly CapFreezeContractService _capFreezeContractService;
        private readonly CapFreezePageService _capFreezePageService;

        public CapFreezeSyncController(
CapFreezeContractService capFreezeContractService,
CapFreezePageService capFreezePageService,
CapFreezeSyncService capFreezeSyncService)
        {
            _capFreezeContractService = capFreezeContractService;
            _capFreezePageService = capFreezePageService;
            _capFreezeSyncService = capFreezeSyncService;
        }

        [HttpGet("capfreeze/test-sync-team")]
        public async Task<IActionResult> TestSyncCapFreezeTeam(
[FromQuery] string teamSlug,
[FromQuery] int nhlTeamId)
        {
            var result =
                await _capFreezeSyncService.SyncCapFreezeTeamAsync(
                    teamSlug,
                    nhlTeamId);

            return Ok(result);
        }

        [HttpGet("capfreeze/sync-all-teams")]
        public async Task<IActionResult> SyncAllCapFreezeTeams()
        {
            var result =
                await _capFreezeSyncService.SyncAllCapFreezeTeamsAsync();

            return Ok(result);
        }
    }
}
