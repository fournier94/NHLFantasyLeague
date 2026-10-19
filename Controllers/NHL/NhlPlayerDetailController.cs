using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [AllowAnonymous]
    [ApiController]
    [Route("api/[controller]")]
    public class NhlPlayerDetailController : ControllerBase
    {
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