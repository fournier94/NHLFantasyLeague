using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.CapFreeze
{
    [AllowAnonymous]
    [ApiController]
    [Route("api/[controller]")]
    public class CapFreezeContractController : ControllerBase
    {
        private readonly CapFreezeContractService _capFreezeContractService;
        private readonly CapFreezePageService _capFreezePageService;
        private readonly AppDbContext _dbContext;

        public CapFreezeContractController(
CapFreezeContractService capFreezeContractService,
CapFreezePageService capFreezePageService,
AppDbContext dbContext)
        {
            _capFreezeContractService = capFreezeContractService;
            _capFreezePageService = capFreezePageService;
            _dbContext = dbContext;
        }

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

        /// <summary>
        /// Returns every manually locked contract, with the player's
        /// name and NHL team filled in. `IsActive` is false when the
        /// current season has already moved past the lock's last
        /// season, at which point the lock is purely historical and
        /// the admin page hides it.
        /// </summary>
        [HttpGet("capfreeze/protected-contracts")]
        public async Task<IActionResult> GetProtectedContracts()
        {
            // Kept in sync with the current-season constants used by
            // PlayerDetailService / RosterAdminService. Bump this each
            // October when the new season starts.
            const int CurrentSeasonNhlCode = 20262027;

            var locked = CapFreezeContractService
                .GetProtectedContracts()
                .ToList();

            if (locked.Count == 0)
            {
                return Ok(new
                {
                    CurrentSeasonNhlCode,
                    ProtectedContracts = Array.Empty<object>()
                });
            }

            var nhlIds = locked
                .Select(l => l.NhlPlayerId)
                .Distinct()
                .ToList();

            var players = await _dbContext.Players
                .AsNoTracking()
                .Where(p => nhlIds.Contains(p.NhlPlayerId))
                .Select(p => new
                {
                    p.NhlPlayerId,
                    p.FirstName,
                    p.LastName,
                    TeamAbbreviation = p.NhlTeam != null
                        ? p.NhlTeam.Abbreviation
                        : null
                })
                .ToListAsync();

            var byNhlId = players
                .GroupBy(p => p.NhlPlayerId)
                .ToDictionary(g => g.Key, g => g.First());

            var result = locked
                .GroupBy(l => l.NhlPlayerId)
                .Select(g =>
                {
                    byNhlId.TryGetValue(g.Key, out var player);

                    var maxEnd = g.Max(c => c.EndSeason);

                    return new
                    {
                        NhlPlayerId = g.Key,
                        PlayerName = player != null
                            ? $"{player.FirstName} {player.LastName}"
                            : "(unknown)",
                        TeamAbbreviation = player?.TeamAbbreviation,
                        Contracts = g
                            .OrderBy(c => c.StartSeason)
                            .Select(c => new
                            {
                                c.StartSeason,
                                c.EndSeason,
                                c.Salary
                            })
                            .ToList(),
                        ExpiresAfterSeason = maxEnd,
                        IsActive = maxEnd >= CurrentSeasonNhlCode
                    };
                })
                .OrderBy(x => x.PlayerName)
                .ToList();

            return Ok(new
            {
                CurrentSeasonNhlCode,
                ProtectedContracts = result
            });
        }
    }
}