using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [ApiController]
    [Route("api/[controller]")]
    public class NhlPlayerDetailController : ControllerBase
    {
        /// <summary>
        /// Thirty seconds. Player bio, contracts and career tables
        /// change slowly, but the current-season stats (GP, G, A,
        /// PTS, FP) are updated by the live refresh every 60 seconds
        /// during games. The live refresh also invalidates this cache
        /// on every tick that persists a change, so a 30-second TTL is
        /// the worst-case upper bound when the invalidation is missed
        /// (e.g. a live tick that produced zero deltas, or a request
        /// that raced the invalidation). Roster edits invalidate this
        /// cache explicitly via RosterAdminService.OnRosterChanged.
        /// </summary>
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(30);

        private readonly PlayerDetailService _playerDetailService;
        private readonly ResponseCacheService _cache;

        public NhlPlayerDetailController(
            PlayerDetailService playerDetailService,
            ResponseCacheService cache)
        {
            _playerDetailService = playerDetailService;
            _cache = cache;
        }

        /// <summary>
        /// Returns everything the player detail page needs for one NHL
        /// player, keyed by NhlPlayerId (the NHL API id, not the
        /// database id). Cached for 60 seconds.
        /// </summary>
        [HttpGet("{nhlPlayerId:int}")]
        public async Task<IActionResult> GetPlayerDetail(int nhlPlayerId)
        {
            var cacheKey = $"player-detail:{nhlPlayerId}";

            var detail = await _cache.GetOrCreateAsync(
                cacheKey,
                CacheTtl,
                () => _playerDetailService.GetPlayerDetailAsync(nhlPlayerId));

            if (detail == null)
            {
                return NotFound();
            }

            return Ok(detail);
        }

        /// <summary>
        /// Returns only the career tables (regular season, playoffs,
        /// tournaments, youth/minor) plus the NHL totals line.
        /// Split out of the main player detail response so the initial
        /// page load stays small; PlayerPage fetches this in a second
        /// call as soon as the main response is on screen.
        /// </summary>
        [HttpGet("{nhlPlayerId:int}/career")]
        public async Task<IActionResult> GetPlayerCareer(int nhlPlayerId)
        {
            var cacheKey = $"player-career:{nhlPlayerId}";

            var career = await _cache.GetOrCreateAsync(
                cacheKey,
                CacheTtl,
                () => _playerDetailService.GetPlayerCareerAsync(nhlPlayerId));

            if (career == null)
            {
                return NotFound();
            }

            return Ok(career);
        }
    }
}