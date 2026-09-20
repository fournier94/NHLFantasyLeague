using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.CapFreeze;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using System.Collections.Generic;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.CapFreeze
{
    public class CapFreezeSyncService
    {
        private readonly AppDbContext _dbContext;
        private readonly CapFreezePageService _capFreezePageService;
        private readonly CapFreezeMatchingService _capFreezeMatchingService;
        private readonly CapFreezeContractService _capFreezeContractService;

        // Players that are handled manually and skipped by the CapFreeze
        // status/contract sync (matched by NAME, so it survives DB rebuilds).
        private static bool IsEliasPettersson(Player player)
        {
            return string.Equals(
                       player.FirstName?.Trim(),
                       "Elias",
                       StringComparison.OrdinalIgnoreCase)
                   &&
                   string.Equals(
                       player.LastName?.Trim(),
                       "Pettersson",
                       StringComparison.OrdinalIgnoreCase);
        }

        private sealed record ManualPlayerOverride(
            int NhlPlayerId,
            int StartSeason,
            int EndSeason,
            decimal Salary);

        // Manual values applied AFTER the whole CapFreeze sync.
        // Status is always forced to Rostered for these players.
        // The contract is only created if the player has no contract at all.
        private static readonly ManualPlayerOverride[] ManualPlayerOverrides =
        {
    new(8480012, 20262027, 20312032, 11600000.00m),
    new(8483678, 20262027, 20262027, 913333.00m)
};

        private static readonly Dictionary<string, string> CapFreezeTeamSlugs =
new(StringComparer.OrdinalIgnoreCase)
{
["NJD"] = "new-jersey-devils",
["NYI"] = "new-york-islanders",
["NYR"] = "new-york-rangers",
["PHI"] = "philadelphia-flyers",
["PIT"] = "pittsburgh-penguins",

["BOS"] = "boston-bruins",
["BUF"] = "buffalo-sabres",
["MTL"] = "montreal-canadiens",
["OTT"] = "ottawa-senators",
["TOR"] = "toronto-maple-leafs",

["CAR"] = "carolina-hurricanes",
["FLA"] = "florida-panthers",
["TBL"] = "tampa-bay-lightning",
["WSH"] = "washington-capitals",

["CHI"] = "chicago-blackhawks",
["DET"] = "detroit-red-wings",
["NSH"] = "nashville-predators",
["STL"] = "st-louis-blues",

["CGY"] = "calgary-flames",
["COL"] = "colorado-avalanche",
["EDM"] = "edmonton-oilers",
["VAN"] = "vancouver-canucks",

["ANA"] = "anaheim-ducks",
["DAL"] = "dallas-stars",
["LAK"] = "los-angeles-kings",
["SJS"] = "san-jose-sharks",
["CBJ"] = "columbus-blue-jackets",
["MIN"] = "minnesota-wild",
["WPG"] = "winnipeg-jets",
["VGK"] = "vegas-golden-knights",
["SEA"] = "seattle-kraken",
["UTA"] = "utah-mammoth"
};


        public CapFreezeSyncService(
    AppDbContext dbContext,
    CapFreezePageService capFreezePageService,
    CapFreezeMatchingService capFreezeMatchingService,
    CapFreezeContractService capFreezeContractService)
        {
            _dbContext = dbContext;
            _capFreezePageService = capFreezePageService;
            _capFreezeMatchingService = capFreezeMatchingService;
            _capFreezeContractService = capFreezeContractService;
        }

        public async Task<object> SyncCapFreezeTeamAsync(
            string teamSlug,
            int nhlTeamId,
            DateTime? runStartedUtc = null)
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(teamSlug);

            var forwards =
                _capFreezePageService.ExtractCapFreezePlayerLinks(html, "Forwards");

            var defense =
                _capFreezePageService.ExtractCapFreezePlayerLinks(html, "Defense");

            var goalies =
                _capFreezePageService.ExtractCapFreezePlayerLinks(html, "Goalies");

            var minors =
                _capFreezePageService.ExtractCapFreezePlayerLinks(html, "Non-Roster / Minors");

            var unsignedRfas =
                _capFreezePageService.ExtractCapFreezePlayerLinks(html, "Unsigned RFAs");

            var deadCap =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(html, "Dead Cap");

            // ---------------------------------------------------------
            // BUILD ENTRY LIST (a slug can only appear once)
            // ---------------------------------------------------------

            var playerLinks =
                new List<(CapFreezePlayerLink Player, PlayerStatus Status)>();

            var seenSlugs =
                new HashSet<string>(StringComparer.OrdinalIgnoreCase);

            void AddLinks(List<CapFreezePlayerLink> links, PlayerStatus status)
            {
                foreach (var link in links)
                {
                    if (seenSlugs.Add(link.Slug))
                        playerLinks.Add((link, status));
                }
            }

            AddLinks(forwards, PlayerStatus.Rostered);
            AddLinks(defense, PlayerStatus.Rostered);
            AddLinks(goalies, PlayerStatus.Rostered);
            AddLinks(minors, PlayerStatus.FarmPlayer);
            AddLinks(unsignedRfas, PlayerStatus.RFA);

            // ---------------------------------------------------------
            // LOAD PLAYERS
            // ---------------------------------------------------------

            var allPlayers =
                await _dbContext.Players.ToListAsync();

            var teamPlayers =
                allPlayers
                    .Where(p =>
                        p.NhlTeamId == nhlTeamId ||
                        p.PreviousNhlTeamId == nhlTeamId)
                    .ToList();

            var currentTeamPlayers =
                allPlayers
                    .Where(p => p.NhlTeamId == nhlTeamId)
                    .ToList();

            // ---------------------------------------------------------
            // PRELOAD EXISTING CONTRACTS
            // ---------------------------------------------------------

            var teamPlayerIds =
                teamPlayers.Select(p => p.Id).Distinct().ToList();

            var preloadedContracts =
                await _dbContext.PlayerContracts
                    .Where(c => teamPlayerIds.Contains(c.PlayerId))
                    .GroupBy(c => c.PlayerId)
                    .ToDictionaryAsync(
                        g => g.Key,
                        g => g.ToList());

            // ---------------------------------------------------------
            // PRELOAD ALL REVIEWS (duplicate-safe)
            // ---------------------------------------------------------

            var existingReviews =
                await _dbContext.CapFreezePlayerReviews.ToListAsync();

            var reviewLookup =
                new Dictionary<(string CapFreezeName, int PlayerId), CapFreezePlayerReview>();

            foreach (var review in existingReviews)
                reviewLookup.TryAdd((review.CapFreezeName, review.PlayerId), review);

            // ---------------------------------------------------------
            // MARK CURRENT PLAYERS AS UNSIGNED FIRST.
            // Skipped: Elias Pettersson (handled manually), dead-cap
            // players, and players already resolved earlier in THIS run.
            // ---------------------------------------------------------

            var normalizedDeadCapNames =
                deadCap
                    .Select(_capFreezeMatchingService.NormalizePlayerName)
                    .ToHashSet();

            foreach (var player in currentTeamPlayers)
            {
                if (IsEliasPettersson(player))
                    continue;

                if (runStartedUtc.HasValue &&
                    player.CapFreezeStatusLastUpdated >= runStartedUtc.Value)
                {
                    continue;
                }

                var normalizedOfficialName =
                    _capFreezeMatchingService.NormalizePlayerName(
                        $"{player.FirstName} {player.LastName}");

                var normalizedCapFreezeName =
                    string.IsNullOrWhiteSpace(player.CapFreezeName)
                        ? string.Empty
                        : _capFreezeMatchingService.NormalizePlayerName(
                            player.CapFreezeName!);

                var isDeadCap =
                    normalizedDeadCapNames.Contains(normalizedOfficialName)
                    ||
                    (
                        !string.IsNullOrWhiteSpace(normalizedCapFreezeName)
                        &&
                        normalizedDeadCapNames.Contains(normalizedCapFreezeName)
                    );

                if (isDeadCap)
                    continue;

                player.Status = PlayerStatus.Unsigned;
            }

            // ---------------------------------------------------------
            // MATCH ALL CAPFREEZE ENTRIES AT ONCE
            // ---------------------------------------------------------

            var matchResults =
                _capFreezeMatchingService.MatchCapFreezeTeamEntries(
                    playerLinks.Select(x => x.Player).ToList(),
                    nhlTeamId,
                    allPlayers,
                    reviewLookup);

            var processedPlayers = new List<object>();
            var unmatchedPlayers = new List<string>();
            var pendingReviews = new List<string>();
            var skippedManualPlayers = new List<string>();

            // ---------------------------------------------------------
            // APPLY STATUS + CONTRACTS FOR MATCHED PLAYERS ONLY
            // ---------------------------------------------------------

            for (var i = 0; i < playerLinks.Count; i++)
            {
                var status = playerLinks[i].Status;
                var match = matchResults[i];
                var player = match.Player;

                if (player == null)
                {
                    unmatchedPlayers.Add(match.Entry.Name);

                    if (match.ReviewCandidate != null)
                    {
                        pendingReviews.Add(
                            $"{match.Entry.Name} -> " +
                            $"{match.ReviewCandidate.FirstName} {match.ReviewCandidate.LastName} " +
                            $"(player id {match.ReviewCandidate.Id})");
                    }

                    continue;
                }

                // Elias Pettersson is handled manually after the whole sync.
                // No status change, no contract change, no timestamps.
                if (IsEliasPettersson(player))
                {
                    skippedManualPlayers.Add(
                        $"{match.Entry.Name} (NhlPlayerId {player.NhlPlayerId})");

                    continue;
                }

                // Remember the link so next week's sync resolves this player instantly.
                player.CapFreezeName = match.Entry.Name;
                player.CapFreezeSlug = match.Entry.Slug;

                player.Status = status;
                player.CapFreezeStatusLastUpdated = DateTime.UtcNow;

                var shouldSyncContract = status != PlayerStatus.RFA;

                if (shouldSyncContract)
                {
                    await _capFreezeContractService.SyncPlayerContractsAsync(
                        player.Id,
                        match.Entry.Slug,
                        false,
                        preloadedContracts,
                        player);
                }

                processedPlayers.Add(
                    new
                    {
                        player.Id,
                        player.NhlPlayerId,
                        player.FirstName,
                        player.LastName,
                        CapFreezeName = player.CapFreezeName,
                        CapFreezeSlug = match.Entry.Slug,
                        MatchType = match.MatchType,
                        Status = player.Status.ToString(),
                        ContractSynchronized = shouldSyncContract,
                        player.CapFreezeStatusLastUpdated,
                        player.CapFreezeContractLastUpdated,
                        player.NhlTeamId,
                        player.PreviousNhlTeamId
                    });
            }

            // ---------------------------------------------------------
            // SAVE THIS TEAM
            // ---------------------------------------------------------

            await _dbContext.SaveChangesAsync();

            return new
            {
                TeamSlug = teamSlug,
                NhlTeamId = nhlTeamId,
                ForwardsCount = forwards.Count,
                DefenseCount = defense.Count,
                GoaliesCount = goalies.Count,
                MinorsCount = minors.Count,
                UnsignedRfasCount = unsignedRfas.Count,
                TotalPlayersFound = playerLinks.Count,
                PlayersProcessed = processedPlayers.Count,
                SkippedManualPlayers = skippedManualPlayers,
                UnmatchedPlayers = unmatchedPlayers,
                PendingReviews = pendingReviews,
                Players = processedPlayers
            };
        }

        public async Task<object> SyncAllCapFreezeTeamsAsync()
        {
            // ---------------------------------------------------------
            // LOAD ALL NHL TEAMS
            // ---------------------------------------------------------

            var teams =
                await _dbContext.NhlTeams
                    .OrderBy(t => t.NhlTeamId)
                    .ToListAsync();

            if (teams.Count == 0)
            {
                throw new InvalidOperationException(
                    "No NHL teams were found in the database.");
            }

            // ---------------------------------------------------------
            // VALIDATE ALL TEAM SLUG MAPPINGS BEFORE SYNCING ANYTHING
            // ---------------------------------------------------------

            var teamsWithoutSlug =
                teams
                    .Where(t =>
                        string.IsNullOrWhiteSpace(t.Abbreviation) ||
                        !CapFreezeTeamSlugs.ContainsKey(
                            t.Abbreviation.Trim()))
                    .Select(t =>
                        $"{t.Name} ({t.Abbreviation})")
                    .ToList();

            if (teamsWithoutSlug.Count > 0)
            {
                throw new InvalidOperationException(
                    "The following NHL teams do not have a CapFreeze slug mapping: " +
                    string.Join(", ", teamsWithoutSlug));
            }

            // ---------------------------------------------------------
            // RESULTS
            // ---------------------------------------------------------

            var successfulTeams =
                new List<object>();

            var failedTeams =
                new List<object>();

            var runStartedUtc = DateTime.UtcNow;

            // ---------------------------------------------------------
            // SYNC EACH TEAM SEQUENTIALLY (one transaction per team)
            // ---------------------------------------------------------

            foreach (var team in teams)
            {
                var abbreviation =
                    team.Abbreviation.Trim();

                var teamSlug =
                    CapFreezeTeamSlugs[abbreviation];

                await using var transaction =
                    await _dbContext.Database.BeginTransactionAsync();

                try
                {
                    var result =
                        await SyncCapFreezeTeamAsync(
                            teamSlug,
                            team.NhlTeamId,
                            runStartedUtc);

                    await transaction.CommitAsync();

                    successfulTeams.Add(
                        new
                        {
                            team.Id,
                            team.NhlTeamId,
                            team.Name,
                            team.Abbreviation,
                            CapFreezeSlug = teamSlug,
                            Result = result
                        });
                }
                catch (Exception ex)
                {
                    try
                    {
                        await transaction.RollbackAsync();
                    }
                    catch
                    {
                        // Preserve the original synchronization error.
                    }

                    foreach (var entry in
                        _dbContext.ChangeTracker
                            .Entries()
                            .ToList())
                    {
                        entry.State =
                            EntityState.Detached;
                    }

                    failedTeams.Add(
                        new
                        {
                            team.Id,
                            team.NhlTeamId,
                            team.Name,
                            team.Abbreviation,
                            CapFreezeSlug = teamSlug,
                            ErrorType = ex.GetType().Name,
                            ErrorMessage = ex.Message
                        });
                }
            }

            // ---------------------------------------------------------
            // MANUAL OVERRIDES (LAST STEP, ONE FINAL SAVE)
            //
            // Runs after every team has been processed, so nothing in the
            // CapFreeze sync can overwrite these values.
            // ---------------------------------------------------------

            List<string> manualOverrideResults;

            try
            {
                manualOverrideResults =
                    await ApplyManualPlayerOverridesAsync();
            }
            catch (Exception ex)
            {
                manualOverrideResults =
                    new List<string>
                    {
                $"Manual overrides FAILED: {ex.GetType().Name}: {ex.Message}"
                    };
            }

            // ---------------------------------------------------------
            // RETURN COMPLETE SYNC SUMMARY
            // ---------------------------------------------------------

            return new
            {
                TotalTeams = teams.Count,
                SuccessfulTeamsCount = successfulTeams.Count,
                FailedTeamsCount = failedTeams.Count,
                ManualOverrides = manualOverrideResults,
                SuccessfulTeams = successfulTeams,
                FailedTeams = failedTeams
            };
        }

        private async Task<List<string>> ApplyManualPlayerOverridesAsync()
        {
            var messages = new List<string>();

            var nhlPlayerIds =
                ManualPlayerOverrides
                    .Select(o => o.NhlPlayerId)
                    .ToList();

            var players =
                await _dbContext.Players
                    .Where(p => nhlPlayerIds.Contains(p.NhlPlayerId))
                    .ToListAsync();

            var databasePlayerIds =
                players.Select(p => p.Id).ToList();

            var playerIdsWithContracts =
                (await _dbContext.PlayerContracts
                    .Where(c => databasePlayerIds.Contains(c.PlayerId))
                    .Select(c => c.PlayerId)
                    .Distinct()
                    .ToListAsync())
                .ToHashSet();

            foreach (var manual in ManualPlayerOverrides)
            {
                var player =
                    players.FirstOrDefault(p =>
                        p.NhlPlayerId == manual.NhlPlayerId);

                if (player == null)
                {
                    messages.Add(
                        $"NhlPlayerId {manual.NhlPlayerId}: player not found in database, skipped.");

                    continue;
                }

                // Locked property: always Rostered.
                player.Status = PlayerStatus.Rostered;

                if (playerIdsWithContracts.Contains(player.Id))
                {
                    messages.Add(
                        $"NhlPlayerId {manual.NhlPlayerId} ({player.FirstName} {player.LastName}): " +
                        "status set to Rostered, contract already exists (unchanged).");
                }
                else
                {
                    _dbContext.PlayerContracts.Add(
                        new PlayerContract
                        {
                            // Database Id of the player, NOT the NhlPlayerId.
                            PlayerId = player.Id,
                            StartSeason = manual.StartSeason,
                            EndSeason = manual.EndSeason,
                            Salary = manual.Salary
                        });

                    messages.Add(
                        $"NhlPlayerId {manual.NhlPlayerId} ({player.FirstName} {player.LastName}): " +
                        $"status set to Rostered, contract created " +
                        $"({manual.StartSeason}-{manual.EndSeason}, {manual.Salary}).");
                }
            }

            await _dbContext.SaveChangesAsync();

            return messages;
        }
    }
}
