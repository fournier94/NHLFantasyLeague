using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class NhlInjuryController : ControllerBase
    {
        private readonly NhlInjuryService _nhlInjuryService;

        public NhlInjuryController(NhlInjuryService nhlInjuryService)
        {
            _nhlInjuryService = nhlInjuryService;
        }

        /// <summary>
        /// Fetches the ESPN injuries payload and updates Player +
        /// PlayerInjuryHistory. Call this manually for now; a hosted
        /// service will call it on a schedule later.
        /// </summary>
        [HttpPost("refresh")]
        public async Task<IActionResult> Refresh()
        {
            var result = await _nhlInjuryService.RefreshAsync();

            return Ok(result);
        }
    }
}