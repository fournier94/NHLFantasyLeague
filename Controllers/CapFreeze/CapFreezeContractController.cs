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
    public class CapFreezeContractController : ControllerBase
    {
        private readonly CapFreezeContractService _capFreezeContractService;
        private readonly CapFreezePageService _capFreezePageService;

        public class CapFreezePlayerContractReview
        {
            public string Category { get; set; } = string.Empty;
            public string Name { get; set; } = string.Empty;
            public string Slug { get; set; } = string.Empty;
            public string PlayerPageUrl { get; set; } = string.Empty;
            public string Position { get; set; } = string.Empty;

            public bool PageRequestSucceeded { get; set; }

            public int? ExtractedTermYears { get; set; }
            public decimal? ExtractedFirstSalary { get; set; }
            public decimal? ExtractedSecondSalary { get; set; }

            public int GeneratedContractCount { get; set; }

            public List<object> Contracts { get; set; } =
                new List<object>();

            public string? ErrorType { get; set; }
            public string? ErrorMessage { get; set; }
        }

        public CapFreezeContractController(
CapFreezeContractService capFreezeContractService,
CapFreezePageService capFreezePageService)
        {
            _capFreezeContractService = capFreezeContractService;
            _capFreezePageService = capFreezePageService;
        }

        [HttpGet("capfreeze/test-cap-hits")]
        public IActionResult TestCapHits()
        {
            var capHits =
                _capFreezePageService.TestExtractCapHitsFromRow();

            return Ok(capHits);
        }

        [HttpGet("capfreeze/test-contract-sync")]
        public async Task<IActionResult> TestCapFreezeContractSync(
[FromQuery] string playerSlug,
[FromQuery] int playerId)
        {
            var contracts =
                await _capFreezeContractService.SyncPlayerContractsAsync(
                    playerId,
                    playerSlug);

            return Ok(
                contracts.Select(c => new
                {
                    c.Id,
                    c.PlayerId,
                    c.StartSeason,
                    c.EndSeason,
                    c.Salary
                }));
        }

        [HttpGet("capfreeze/review-player-contracts")]
        public async Task<IActionResult> ReviewCapFreezePlayerContracts(
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

            var players =
                forwards
                    .Select(p => new
                    {
                        Player = p,
                        Category = "Forwards"
                    })
                    .Concat(
                        defense.Select(p => new
                        {
                            Player = p,
                            Category = "Defense"
                        }))
                    .Concat(
                        goalies.Select(p => new
                        {
                            Player = p,
                            Category = "Goalies"
                        }))
                    .Concat(
                        minors.Select(p => new
                        {
                            Player = p,
                            Category = "Non-Roster / Minors"
                        }))
                    .Concat(
                        unsignedRfas.Select(p => new
                        {
                            Player = p,
                            Category = "Unsigned RFAs"
                        }))
                    .ToList();

            var results =
                new List<CapFreezePlayerContractReview>();

            foreach (var entry in players)
            {
                var playerPageUrl =
                    $"https://capfreeze.com/players/{entry.Player.Slug}.html";

                try
                {
                    // Production method
                    var playerHtml =
                        await _capFreezePageService.GetCapFreezePlayerPageAsync(
                            entry.Player.Slug);

                    // Use the same player name production sync uses
                    // for contract extraction.
                    var contractData =
                        _capFreezeContractService.ExtractCapFreezeContractData(
                            playerHtml,
                            entry.Player.Name);

                    if (contractData == null)
                    {
                        results.Add(
                            new CapFreezePlayerContractReview
                            {
                                Category = entry.Category,
                                Name = entry.Player.Name,
                                Slug = entry.Player.Slug,
                                PlayerPageUrl = playerPageUrl,
                                Position = entry.Player.Position,
                                PageRequestSucceeded = true,
                                GeneratedContractCount = 0
                            });

                        continue;
                    }

                    // Use the exact production contract-building method.
                    var contracts =
                        _capFreezeContractService.BuildPlayerContracts(
                            0,
                            contractData);

                    results.Add(
                        new CapFreezePlayerContractReview
                        {
                            Category = entry.Category,
                            Name = entry.Player.Name,
                            Slug = entry.Player.Slug,
                            PlayerPageUrl = playerPageUrl,
                            Position = entry.Player.Position,
                            PageRequestSucceeded = true,

                            ExtractedTermYears =
                                contractData.TermYears,

                            ExtractedFirstSalary =
                                contractData.FirstSalary,

                            ExtractedSecondSalary =
                                contractData.SecondSalary,

                            GeneratedContractCount =
                                contracts.Count,

                            Contracts =
                                contracts
                                    .Select(c => (object)new
                                    {
                                        StartSeason = c.StartSeason,
                                        EndSeason = c.EndSeason,
                                        Salary = c.Salary
                                    })
                                    .ToList()
                        });
                }
                catch (Exception ex)
                {
                    results.Add(
                        new CapFreezePlayerContractReview
                        {
                            Category = entry.Category,
                            Name = entry.Player.Name,
                            Slug = entry.Player.Slug,
                            PlayerPageUrl = playerPageUrl,
                            Position = entry.Player.Position,
                            PageRequestSucceeded = false,
                            GeneratedContractCount = 0,
                            ErrorType = ex.GetType().Name,
                            ErrorMessage = ex.Message
                        });
                }
            }

            return Ok(new
            {
                TeamSlug = teamSlug,

                TotalPlayers = results.Count,

                SuccessfulPages =
                    results.Count(r => r.PageRequestSucceeded),

                FailedPages =
                    results.Count(r => !r.PageRequestSucceeded),

                ContractExtractionSucceeded =
                    results.Count(r =>
                        r.PageRequestSucceeded &&
                        r.ExtractedTermYears.HasValue),

                ContractExtractionFailed =
                    results.Count(r =>
                        r.PageRequestSucceeded &&
                        !r.ExtractedTermYears.HasValue),

                OneContract =
                    results.Count(r =>
                        r.GeneratedContractCount == 1),

                TwoContracts =
                    results.Count(r =>
                        r.GeneratedContractCount == 2),

                OtherContractCount =
                    results.Count(r =>
                        r.GeneratedContractCount != 1 &&
                        r.GeneratedContractCount != 2),

                Players = results
            });
        }
    }
}
