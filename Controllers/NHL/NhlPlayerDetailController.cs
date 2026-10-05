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
        /// Short TTL: the payload includes current-season stats,
        /// recent games and roster status, which change during live
        /// games. 60 seconds keeps the player page snappy while still
        /// reflecting the post-game write within the minute.
        /// </summary>
        private static readonly TimeSpan CacheTtl = TimeSpan.FromSeconds(60);

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