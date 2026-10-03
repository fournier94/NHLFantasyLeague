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

        /// <summary>
        /// One locked contract shape. Any existing row with the same
        /// StartSeason is forced to these values; missing rows are
        /// created; any other row for the player is removed.
        /// </summary>
        private sealed record LockedContract(
            int StartSeason,
            int EndSeason,
            decimal Salary);

        /// <summary>
        /// Public projection of one locked contract. Used by the
        /// admin page to display which players have manually locked
        /// contracts without exposing the private record type.
        /// </summary>
        public sealed record ProtectedContractInfo(
            int NhlPlayerId,
            int StartSeason,
            int EndSeason,
            decimal Salary);

        /// <summary>
        /// Flattens the protected-contracts table into one row per
        /// locked contract. Safe to call from the controller; no DB
        /// access.
        /// </summary>
        public static IEnumerable<ProtectedContractInfo>
            GetProtectedContracts()
        {
            foreach (var kvp in ProtectedPlayerContracts)
            {
                foreach (var c in kvp.Value)
                {
                    yield return new ProtectedContractInfo(
                        kvp.Key,
                        c.StartSeason,
                        c.EndSeason,
                        c.Salary);
                }
            }
        }

        /// <summary>
        /// Contracts that are manually locked and must never be
        /// overwritten by the CapFreeze sync. Keyed by NhlPlayerId.
        ///
        /// When a player is listed here, SyncPlayerContractsAsync
        /// skips the CapFreeze fetch entirely and forces the contract
        /// rows to the locked shape. The CapFreeze contract timestamp
        /// is NOT updated, so the sync summary accurately reflects
        /// that this player's contract was not re-fetched.
        ///
        /// The fantasy salary is derived from the contract in
        /// RosterAdminService, so locking the contract is enough to
        /// lock the salary used for the cap.
        /// </summary>
        private static readonly Dictionary<int, List<LockedContract>>
            ProtectedPlayerContracts = new()
            {
                // NhlPlayerId 8478450: locked to a single-season
                // 1 000 000 $ contract for the 2026-2027 season.
                [8478450] = new List<LockedContract>
                {
                    new LockedContract(
                        StartSeason: 20262027,
                        EndSeason: 20262027,
                        Salary: 1000000m),
                },
            };

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

            // ---------------------------------------------------------
            // STEP 1:
            // Find the Contract by Season table.
            // ---------------------------------------------------------

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

            // ---------------------------------------------------------
            // STEP 2:
            // Read the first season from the table header.
            //
            // Example:
            // 2026-27
            // ---------------------------------------------------------

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

            // ---------------------------------------------------------
            // STEP 3:
            // Extract the contract length.
            //
            // We already tested ExtractContractYears().
            // ---------------------------------------------------------

            var termYears =
                ExtractContractYears(
                    html);

            if (!termYears.HasValue)
                return null;

            // ---------------------------------------------------------
            // STEP 4:
            // Get the first contract row.
            // ---------------------------------------------------------

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

            // ---------------------------------------------------------
            // STEP 5:
            // First salary.
            // ---------------------------------------------------------

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

            // ---------------------------------------------------------
            // STEP 6:
            // Second salary.
            //
            // If the player becomes UFA/RFA immediately after
            // the first contract, data-v may be 0.
            // ---------------------------------------------------------

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

            // 1 year remaining:
            // Create exactly one contract for that season.
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

            // Every contract longer than 1 year must have
            // a second-year salary available.
            if (!contractData.SecondSalary.HasValue)
            {
                throw new InvalidOperationException(
                    $"CapFreeze contract data is invalid for PlayerId={playerId}. " +
                    $"TermYears={contractData.TermYears}, " +
                    $"but no second-year salary was found.");
            }

            // More than 1 year remaining and same salary:
            // Create one contract covering the entire remaining term.
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

            // More than 1 year remaining and different salaries:
            // First year gets its own contract.
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

            // Remaining years get the second contract.
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

        /// <summary>
        /// Forces the player's contract rows to the locked shape:
        /// upserts by StartSeason, and removes any row not covered by
        /// the lock. Returns the resulting list of contracts for the
        /// player. Respects the caller's preloaded-contracts cache and
        /// saveChanges flag.
        /// </summary>
        private async Task<List<PlayerContract>> ApplyLockedContractsAsync(
            int playerId,
            List<LockedContract> lockedContracts,
            bool saveChanges,
            Dictionary<int, List<PlayerContract>>? preloadedContracts)
        {
            List<PlayerContract> existing;

            if (preloadedContracts != null &&
                preloadedContracts.TryGetValue(playerId, out var cached))
            {
                existing = cached;
            }
            else
            {
                existing = await _dbContext.PlayerContracts
                    .Where(c => c.PlayerId == playerId)
                    .ToListAsync();
            }

            var byStartSeason = existing
                .GroupBy(c => c.StartSeason)
                .ToDictionary(g => g.Key, g => g.First());

            var lockedStarts = lockedContracts
                .Select(l => l.StartSeason)
                .ToHashSet();

            foreach (var locked in lockedContracts)
            {
                if (byStartSeason.TryGetValue(
                        locked.StartSeason,
                        out var existingRow))
                {
                    existingRow.EndSeason = locked.EndSeason;
                    existingRow.Salary = locked.Salary;
                }
                else
                {
                    var newRow = new PlayerContract
                    {
                        PlayerId = playerId,
                        StartSeason = locked.StartSeason,
                        EndSeason = locked.EndSeason,
                        Salary = locked.Salary
                    };

                    _dbContext.PlayerContracts.Add(newRow);

                    existing.Add(newRow);
                    byStartSeason[locked.StartSeason] = newRow;
                }
            }

            foreach (var row in byStartSeason.Values.ToList())
            {
                if (!lockedStarts.Contains(row.StartSeason))
                {
                    _dbContext.PlayerContracts.Remove(row);
                    existing.Remove(row);
                }
            }

            if (preloadedContracts != null)
            {
                preloadedContracts[playerId] = existing;
            }

            if (saveChanges)
            {
                await _dbContext.SaveChangesAsync();
            }

            return existing;
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
            // PROTECTED CONTRACTS
            //
            // Some players have their contract values manually locked
            // so CapFreeze can never overwrite them. When the player
            // is in ProtectedPlayerContracts, we skip the fetch
            // entirely and force the contract rows to the locked
            // shape. The CapFreeze contract timestamp is NOT updated,
            // matching the Elias Pettersson behavior.
            // ---------------------------------------------------------

            if (ProtectedPlayerContracts.TryGetValue(
                    player.NhlPlayerId,
                    out var lockedContracts))
            {
                return await ApplyLockedContractsAsync(
                    playerId,
                    lockedContracts,
                    saveChanges,
                    preloadedContracts);
            }

            // ---------------------------------------------------------
            // SPECIAL CASE:
            // Elias Pettersson records are manually protected.
            //
            // We do not fetch or modify their contracts automatically.
            // Since no CapFreeze contract page is successfully
            // synchronized here, the contract timestamp is NOT updated.
            // ---------------------------------------------------------

            var isEliasPettersson =
                string.Equals(
                    player.FirstName?.Trim(),
                    "Elias",
                    StringComparison.OrdinalIgnoreCase)
                &&
                string.Equals(
                    player.LastName?.Trim(),
                    "Pettersson",
                    StringComparison.OrdinalIgnoreCase);

            if (isEliasPettersson)
            {
                return await _dbContext.PlayerContracts
                    .Where(c => c.PlayerId == playerId)
                    .ToListAsync();
            }

            // ---------------------------------------------------------
            // FETCH CAPFREEZE PLAYER PAGE
            // ---------------------------------------------------------

            var html =
                await _capFreezePageService.GetCapFreezePlayerPageAsync(
                    playerSlug);

            var playerName =
                $"{player.FirstName} {player.LastName}";

            // ---------------------------------------------------------
            // EXTRACT CONTRACT DATA
            //
            // If extraction fails, an exception is thrown and the
            // CapFreezeContractLastUpdated timestamp is NOT changed.
            // ---------------------------------------------------------

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

            // ---------------------------------------------------------
            // BUILD EXPECTED CONTRACTS
            // ---------------------------------------------------------

            var expectedContracts =
                BuildPlayerContracts(
                    player.Id,
                    contractData);

            // ---------------------------------------------------------
            // LOAD EXISTING CONTRACTS
            // ---------------------------------------------------------

            List<PlayerContract> existingContractsList;

            if (preloadedContracts != null &&
                preloadedContracts.TryGetValue(
                    playerId,
                    out var cachedContracts))
            {
                existingContractsList =
                    cachedContracts;
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

            // ---------------------------------------------------------
            // UPDATE EXISTING / ADD NEW CONTRACTS
            // ---------------------------------------------------------

            foreach (var expectedContract in expectedContracts)
            {
                if (existingContracts.TryGetValue(
                        expectedContract.StartSeason,
                        out var existingContract))
                {
                    existingContract.EndSeason =
                        expectedContract.EndSeason;

                    existingContract.Salary =
                        expectedContract.Salary;
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

            // ---------------------------------------------------------
            // REMOVE STALE CONTRACTS
            // ---------------------------------------------------------

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

            // ---------------------------------------------------------
            // CONTRACT SYNCHRONIZATION SUCCEEDED
            //
            // Only now do we update the timestamp.
            //
            // If SaveChangesAsync() is used here, the timestamp and
            // contract changes are saved together.
            //
            // If saveChanges == false, the timestamp remains tracked
            // on the Player entity and will be saved by the caller.
            // ---------------------------------------------------------

            player.CapFreezeContractLastUpdated =
                DateTime.UtcNow;

            // ---------------------------------------------------------
            // UPDATE PRELOADED CACHE
            // ---------------------------------------------------------

            if (preloadedContracts != null)
            {
                preloadedContracts[playerId] =
                    existingContractsList;
            }

            // ---------------------------------------------------------
            // SAVE IF REQUESTED
            // ---------------------------------------------------------

            if (saveChanges)
            {
                await _dbContext.SaveChangesAsync();
            }

            return expectedContracts;
        }
    }
}
