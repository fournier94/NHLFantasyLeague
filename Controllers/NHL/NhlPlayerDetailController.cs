using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [ApiController]
    [Route("api/[controller]")]
    public class NhlPlayerDetailController : ControllerBase
    {
        private readonly PlayerDetailService _playerDetailService;

        public NhlPlayerDetailController(PlayerDetailService playerDetailService)
        {
            _playerDetailService = playerDetailService;
        }

        /// <summary>
        /// Returns everything the player detail page needs for one NHL
        /// player, keyed by NhlPlayerId (the NHL API id, not the
        /// database id).
        /// </summary>
        [HttpGet("{nhlPlayerId:int}")]
        public async Task<IActionResult> GetPlayerDetail(int nhlPlayerId)
        {
            var detail = await _playerDetailService.GetPlayerDetailAsync(nhlPlayerId);

            if (detail == null)
            {
                return NotFound();
            }

            return Ok(detail);
        }
    }
}