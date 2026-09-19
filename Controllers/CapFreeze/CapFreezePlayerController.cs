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
    public class CapFreezePlayerController : ControllerBase
    {
        private readonly CapFreezePageService _capFreezePageService;

        public CapFreezePlayerController(
CapFreezePageService capFreezePageService)
        {
            _capFreezePageService = capFreezePageService;
        }

        [HttpGet("capfreeze/test-forwards")]
        public async Task<IActionResult> TestCapFreezeForwards()
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Forwards");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-defense")]
        public async Task<IActionResult> TestCapFreezeDefense()
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Defense");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-goalies")]
        public async Task<IActionResult> TestCapFreezeGoalies()
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Goalies");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-minors")]
        public async Task<IActionResult> TestCapFreezeMinors()
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Non-Roster / Minors");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-rfas")]
        public async Task<IActionResult> TestCapFreezeRfas()
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Unsigned RFAs");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-dead-cap")]
        public async Task<IActionResult> TestCapFreezeDeadCap()
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    "montreal-canadiens");

            var players =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Dead Cap");

            return Ok(players);
        }

        [HttpGet("capfreeze/test-player-page")]
        public async Task<IActionResult> TestCapFreezePlayerPage(
[FromQuery] string playerSlug)
        {
            var html =
                await _capFreezePageService.GetCapFreezePlayerPageAsync(
                    playerSlug);

            return Content(
                html,
                "text/html");
        }

        [HttpGet("capfreeze/test-player-slugs")]
        public async Task<IActionResult> TestCapFreezePlayerSlugs(
[FromQuery] string teamSlug,
[FromQuery] string sectionName)
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    teamSlug);

            var slugs =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    sectionName);

            return Ok(slugs);
        }

        [HttpGet("capfreeze/review-team-page")]
        public async Task<IActionResult> ReviewCapFreezeTeamPage(
[FromQuery] string teamSlug)
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    teamSlug);

            var forwards =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Forwards");

            var defense =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Defense");

            var goalies =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Goalies");

            var minors =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Non-Roster / Minors");

            var unsignedRfas =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Unsigned RFAs");

            return Ok(new
            {
                TeamSlug = teamSlug,

                Forwards = new
                {
                    Count = forwards.Count,
                    Players = forwards.Select(p => new
                    {
                        p.Name,
                        p.Slug,
                        p.Position
                    })
                },

                Defense = new
                {
                    Count = defense.Count,
                    Players = defense.Select(p => new
                    {
                        p.Name,
                        p.Slug,
                        p.Position
                    })
                },

                Goalies = new
                {
                    Count = goalies.Count,
                    Players = goalies.Select(p => new
                    {
                        p.Name,
                        p.Slug,
                        p.Position
                    })
                },

                NonRosterMinors = new
                {
                    Count = minors.Count,
                    Players = minors.Select(p => new
                    {
                        p.Name,
                        p.Slug,
                        p.Position
                    })
                },

                UnsignedRfas = new
                {
                    Count = unsignedRfas.Count,
                    Players = unsignedRfas.Select(p => new
                    {
                        p.Name,
                        p.Slug,
                        p.Position
                    })
                },

                TotalPlayersFound =
                    forwards.Count +
                    defense.Count +
                    goalies.Count +
                    minors.Count +
                    unsignedRfas.Count
            });
        }
    }
}
