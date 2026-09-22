using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// League endpoints: the one-time (idempotent) setup plus the league,
    /// season and fantasy team read endpoints.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class LeagueController : ControllerBase
    {
        private readonly LeagueSetupService _leagueSetupService;

        /// <summary>
        /// Creates the controller.
        /// </summary>
        /// <param name="leagueSetupService">Service that creates or repairs the league data.</param>
        public LeagueController(LeagueSetupService leagueSetupService)
        {
            _leagueSetupService = leagueSetupService;
        }

        /// <summary>
        /// Creates or repairs the league, its seasons, its fantasy teams and
        /// their active-season links. Safe to call multiple times.
        /// </summary>
        /// <returns>A report listing everything that was created or updated.</returns>
        [HttpPost("setup")]
        public async Task<IActionResult> SetupLeague()
        {
            var result = await _leagueSetupService.SetupLeagueAsync();

            return Ok(result);
        }

        /// <summary>
        /// Returns the league with its seasons and fantasy teams.
        /// </summary>
        /// <returns>The league summary, or 404 when the setup has not been run yet.</returns>
        [HttpGet]
        public async Task<IActionResult> GetLeague()
        {
            var league = await _leagueSetupService.GetLeagueAsync();

            if (league == null)
            {
                return NotFound();
            }

            return Ok(league);
        }

        /// <summary>
        /// Returns every season ordered by NHL season code.
        /// </summary>
        /// <returns>The list of seasons.</returns>
        [HttpGet("seasons")]
        public async Task<IActionResult> GetSeasons()
        {
            var seasons = await _leagueSetupService.GetSeasonsAsync();

            return Ok(seasons);
        }

        /// <summary>
        /// Returns every fantasy team ordered by name.
        /// </summary>
        /// <returns>The list of fantasy teams.</returns>
        [HttpGet("teams")]
        public async Task<IActionResult> GetTeams()
        {
            var teams = await _leagueSetupService.GetTeamsAsync();

            return Ok(teams);
        }
    }
}
