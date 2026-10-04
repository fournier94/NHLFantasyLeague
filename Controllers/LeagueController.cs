using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Cache;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// League endpoints: the one-time (idempotent) setup plus the
    /// league, season and fantasy team read endpoints.
    ///
    /// Read endpoints are cached for 10 minutes. League data changes
    /// once a year (setup) and when a team is added or renamed, both
    /// of which go through this controller and invalidate the cache.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class LeagueController : ControllerBase
    {
        private static readonly TimeSpan CacheTtl = TimeSpan.FromMinutes(10);

        private readonly LeagueSetupService _leagueSetupService;
        private readonly ResponseCacheService _cache;

        public LeagueController(
            LeagueSetupService leagueSetupService,
            ResponseCacheService cache)
        {
            _leagueSetupService = leagueSetupService;
            _cache = cache;
        }

        /// <summary>
        /// Creates or repairs the league, its seasons, its fantasy teams and
        /// their active-season links. Safe to call multiple times.
        /// Invalidates the league cache.
        /// </summary>
        [HttpPost("setup")]
        public async Task<IActionResult> SetupLeague()
        {
            var result = await _leagueSetupService.SetupLeagueAsync();

            // Setup can create teams, seasons and the league row
            // itself. Drop every cached read so the next request sees
            // the fresh state.
            _cache.Invalidate("league");

            return Ok(result);
        }

        /// <summary>
        /// Returns the league with its seasons and fantasy teams.
        /// </summary>
        [HttpGet]
        public async Task<IActionResult> GetLeague()
        {
            var league = await _cache.GetOrCreateAsync(
                "league:main",
                CacheTtl,
                () => _leagueSetupService.GetLeagueAsync());

            if (league == null)
            {
                return NotFound();
            }

            return Ok(league);
        }

        /// <summary>
        /// Returns every season ordered by NHL season code.
        /// </summary>
        [HttpGet("seasons")]
        public async Task<IActionResult> GetSeasons()
        {
            var seasons = await _cache.GetOrCreateAsync(
                "league:seasons",
                CacheTtl,
                () => _leagueSetupService.GetSeasonsAsync());

            return Ok(seasons);
        }

        /// <summary>
        /// Returns every fantasy team ordered by name.
        /// </summary>
        [HttpGet("teams")]
        public async Task<IActionResult> GetTeams()
        {
            var teams = await _cache.GetOrCreateAsync(
                "league:teams",
                CacheTtl,
                () => _leagueSetupService.GetTeamsAsync());

            return Ok(teams);
        }
    }
}