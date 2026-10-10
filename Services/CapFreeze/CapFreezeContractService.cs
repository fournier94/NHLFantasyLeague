using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.CapFreeze;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.CapFreeze
{
    public class CapFreezeContractService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;
        private readonly CapFreezePageService _capFreezePageService;

        public CapFreezeContractService(
    HttpClient httpClient,
    AppDbContext dbContext,
    CapFreezePageService capFreezePageService)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _capFreezePageService = capFreezePageService;
        }

        private int? ExtractContractYears(
string html)
        {
            var document =
                new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            var termLeftKey =
                document.DocumentNode
                    .SelectSingleNode(
                        "//div[contains(@class,'card')]/div[contains(@class,'k') and normalize-space()='Term Left']");

            if (termLeftKey == null)
                return null;

            var termLeftValue =
                termLeftKey.ParentNode?
                    .SelectSingleNode(
                        "./div[contains(@class,'v')]");

            if (termLeftValue == null)
                return null;

            var termLeftText =
                System.Net.WebUtility.HtmlDecode(
                    termLeftValue.InnerText.Trim());

            var match =
                System.Text.RegularExpressions.Regex.Match(
                    termLeftText,
                    @"(\d+)\s*yr\b",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            if (!match.Success)
                return null;

            if (!int.TryParse(
                    match.Groups[1].Value,
                    out var years))
            {
                return null;
            }

            return years;
        }

        public CapFreezeContractData? ExtractCapFreezeContractData(
string html,
string playerName)
        {
            var document = new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            var heading =
                document.DocumentNode
                    .SelectSingleNode(
                        "//h2[normalize-space()='Contract by Season']");

            if (heading == null)
                return null;

            var contractTable =
                heading.SelectSingleNode(
                    "following-sibling::table[1]");

            if (contractTable == null)
                return null;

            var firstHeader =
                contractTable
                    .SelectSingleNode(".//thead//th[1]");

            if (firstHeader == null)
                return null;

            var seasonText =
                System.Net.WebUtility.HtmlDecode(
                    firstHeader.InnerText.Trim());

            var seasonMatch =
                System.Text.RegularExpressions.Regex.Match(
                    seasonText,
                    @"^(20\d{2})-(\d{2})$");

            if (!seasonMatch.Success)
                return null;

            var startYear =
                int.Parse(seasonMatch.Groups[1].Value);

            var startSeason =
                startYear * 10000 +
                (startYear + 1);

            var termYears =
                ExtractContractYears(
                    html);

            if (!termYears.HasValue)
                return null;

            var firstRow =
                contractTable.SelectSingleNode(
                    ".//tbody/tr");

            if (firstRow == null)
                return null;

            var salaryCells =
                firstRow.SelectNodes("./td");

            if (salaryCells == null ||
                salaryCells.Count < 2)
            {
                return null;
            }

            var firstSalaryValue =
                salaryCells[0].GetAttributeValue(
                    "data-v",
                    string.Empty);

            if (!decimal.TryParse(
                    firstSalaryValue,
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var firstSalary))
            {
                return null;
            }

            decimal? secondSalary = null;

            var secondSalaryValue =
                salaryCells[1].GetAttributeValue(
                    "data-v",
                    string.Empty);

            if (decimal.TryParse(
                    secondSalaryValue,
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var parsedSecondSalary)
                && parsedSecondSalary > 0)
            {
                secondSalary = parsedSecondSalary;
            }

            return new CapFreezeContractData
            {
                StartSeason = startSeason,
                TermYears = termYears.Value,
                FirstSalary = firstSalary,
                SecondSalary = secondSalary
            };
        }

        public List<PlayerContract> BuildPlayerContracts(
int playerId,
CapFreezeContractData contractData)
        {
            var contracts = new List<PlayerContract>();

            var startSeason =
                contractData.StartSeason;

            if (contractData.TermYears == 1)
            {
                contracts.Add(
                    new PlayerContract
                    {
                        PlayerId = playerId,
                        StartSeason = startSeason,
                        EndSeason = startSeason,
                        Salary = contractData.FirstSalary
                    });

                return contracts;
            }

            if (!contractData.SecondSalary.HasValue)
            {
                throw new InvalidOperationException(
                    $"CapFreeze contract data is invalid for PlayerId={playerId}. " +
                    $"TermYears={contractData.TermYears}, " +
                    $"but no second-year salary was found.");
            }

            if (
                contractData.FirstSalary ==
                contractData.SecondSalary.Value)
            {
                var endSeason =
                    CalculateContractEndSeason(
                        startSeason,
                        contractData.TermYears);

                contracts.Add(
                    new PlayerContract
                    {
                        PlayerId = playerId,
                        StartSeason = startSeason,
                        EndSeason = endSeason,
                        Salary = contractData.FirstSalary
                    });

                return contracts;
            }

            contracts.Add(
                new PlayerContract
                {
                    PlayerId = playerId,
                    StartSeason = startSeason,
                    EndSeason = startSeason,
                    Salary = contractData.FirstSalary
                });

            var secondContractStartSeason =
                GetNextSeason(startSeason);

            var endSeasonAfterFirst =
                CalculateContractEndSeason(
                    startSeason,
                    contractData.TermYears);

            contracts.Add(
                new PlayerContract
                {
                    PlayerId = playerId,
                    StartSeason = secondContractStartSeason,
                    EndSeason = endSeasonAfterFirst,
                    Salary = contractData.SecondSalary.Value
                });

            return contracts;
        }

        private int GetNextSeason(int season)
        {
            var startYear = season / 10000;
            var endYear = season % 10000;

            return (startYear + 1) * 10000 +
                   (endYear + 1);
        }

        private int CalculateContractEndSeason(
    int startSeason,
    int termYears)
        {
            int startYear = startSeason / 10000;

            int endYear = startYear + termYears - 1;

            return (endYear * 10000) + (endYear + 1);
        }

        public async Task<List<PlayerContract>> SyncPlayerContractsAsync(
    int playerId,
    string playerSlug,
    bool saveChanges = true,
    Dictionary<int, List<PlayerContract>>? preloadedContracts = null,
    Player? player = null)
        {
            if (player == null)
            {
                player =
                    await _dbContext.Players
                        .FirstOrDefaultAsync(p => p.Id == playerId);

                if (player == null)
                    return new List<PlayerContract>();
            }

            // ---------------------------------------------------------
            // SKIP MANUAL PLAYERS
            //
            // When the commissioner has flagged a player as manually
            // managed, we do not touch his contract rows at all: no
            // CapFreeze fetch, no extract, no upsert, no prune. The
            // admin's contract rows for this player are authoritative.
            //
            // The caller (CapFreezeSyncService) also skips updating
            // the player's status and slug for flagged players, so
            // nothing about this player changes during a sync.
            // ---------------------------------------------------------

            if (player.SkipCapFreezeSync)
            {
                if (preloadedContracts != null &&
                    preloadedContracts.TryGetValue(
                        playerId,
                        out var cachedContracts))
                {
                    return cachedContracts;
                }

                return await _dbContext.PlayerContracts
                    .Where(c => c.PlayerId == playerId)
                    .ToListAsync();
            }

            var html =
                await _capFreezePageService.GetCapFreezePlayerPageAsync(
                    playerSlug);

            var playerName =
                $"{player.FirstName} {player.LastName}";

            var contractData =
                ExtractCapFreezeContractData(
                    html,
                    playerName);

            if (contractData == null)
            {
                throw new InvalidOperationException(
                    $"Could not extract contract data from CapFreeze " +
                    $"for PlayerId={playerId}, Slug='{playerSlug}'.");
            }

            var expectedContracts =
                BuildPlayerContracts(
                    player.Id,
                    contractData);

            List<PlayerContract> existingContractsList;

            if (preloadedContracts != null &&
                preloadedContracts.TryGetValue(
                    playerId,
                    out var cachedContracts2))
            {
                existingContractsList =
                    cachedContracts2;
            }
            else
            {
                existingContractsList =
                    await _dbContext.PlayerContracts
                        .Where(c =>
                            c.PlayerId == playerId)
                        .ToListAsync();
            }

            var existingContracts =
                existingContractsList
                    .GroupBy(c => c.StartSeason)
                    .ToDictionary(
                        g => g.Key,
                        g => g.First());

            var expectedStartSeasons =
                expectedContracts
                    .Select(c => c.StartSeason)
                    .ToHashSet();

            foreach (var expectedContract in expectedContracts)
            {
                if (existingContracts.TryGetValue(
                        expectedContract.StartSeason,
                        out var existingContract))
                {
                    existingContract.EndSeason =
                        expectedContract.EndSeason;

                    existingContract.Salary =
                        existingContract.ProtectedSalary
                        ?? expectedContract.Salary;
                }
                else
                {
                    _dbContext.PlayerContracts.Add(
                        expectedContract);

                    existingContracts.Add(
                        expectedContract.StartSeason,
                        expectedContract);

                    existingContractsList.Add(
                        expectedContract);
                }
            }

            foreach (var existingContract in existingContracts.Values.ToList())
            {
                if (!expectedStartSeasons.Contains(
                        existingContract.StartSeason))
                {
                    _dbContext.PlayerContracts.Remove(
                        existingContract);

                    existingContractsList.Remove(
                        existingContract);
                }
            }

            player.CapFreezeContractLastUpdated =
                DateTime.UtcNow;

            if (preloadedContracts != null)
            {
                preloadedContracts[playerId] =
                    existingContractsList;
            }

            if (saveChanges)
            {
                await _dbContext.SaveChangesAsync();
            }

            return expectedContracts;
        }
    }
}