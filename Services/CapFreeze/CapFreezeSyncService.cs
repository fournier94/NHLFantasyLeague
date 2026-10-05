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

        /// <summary>
        /// NhlPlayerId of the Vancouver Canucks forward whose CapFreeze
        /// records are manually protected. Matched by ID, NOT by name,
        /// so the other Elias Pettersson in the DB (SHL goalie) is not
        /// caught by this rule.
        /// </summary>
        private const int EliasPetterssonNhlPlayerId = 8480012;

        private static bool IsEliasPettersson(Player player)
        {
            return player.NhlPlayerId == EliasPetterssonNhlPlayerId;
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
            //
            // NOTE: must stay tracked. We mutate player.Status,
            // player.CapFreezeName, player.CapFreezeSlug and
            // player.CapFreezeStatusLastUpdated below and rely on
            // SaveChangesAsync at the end of this method.
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
            //
            // NOTE: must stay tracked. CapFreezeContractService mutates
            // these rows in place and inserts new ones.
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
            //
            // NOTE: kept tracked because MatchCapFreezeTeamEntries may
            // add new CapFreezePlayerReview rows, and the lookup needs
            // to reflect what is already in the DB.
            // ---------------------------------------------------------

            var existingReviews =
                await _dbContext.CapFreezePlayerReviews.ToListAsync();

            var reviewLookup =
                new Dictionary<(string CapFreezeName, int PlayerId), CapFreezePlayerReview>();

            foreach (var review in existingReviews)
                reviewLookup.TryAdd((review.CapFreezeName, review.PlayerId), review);

            // ---------------------------------------------------------
            // COLLECT CURRENT PLAYERS THAT MIGHT NEED TO BE RESET TO
            // UNSIGNED. We do NOT actually reset them here — see the
            // safety check further down. Skipped: Elias Pettersson
            // (handled manually), dead-cap players, and players
            // already resolved earlier in THIS run.
            // ---------------------------------------------------------

            var normalizedDeadCapNames =
                deadCap
                    .Select(_capFreezeMatchingService.NormalizePlayerName)
                    .ToHashSet();

            var playersToResetIfUnmatched = new List<Player>();

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

                playersToResetIfUnmatched.Add(player);
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
            // SAFETY: if CapFreeze returned zero entries for this team,
            // something is wrong (page changed shape, fetch truncated,
            // network failure returning 200 with an empty body). Do
            // NOT touch anyone's status — keep whatever they had.
            // ---------------------------------------------------------

            if (playerLinks.Count == 0)
            {
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
                    TotalPlayersFound = 0,
                    PlayersProcessed = 0,
                    SkippedManualPlayers = new List<string>(),
                    UnmatchedPlayers = new List<string>(),
                    PendingReviews = new List<string>(),
                    Players = new List<object>(),
                    Skipped = "CapFreeze page returned zero players. No status changes applied."
                };
            }

            // ---------------------------------------------------------
            // SAFETY: require a plausible match rate before we reset
            // anyone's status. This is the guard that makes the
            // "everyone went Unsigned" disaster structurally
            // impossible.
            //
            // If CapFreeze returned N entries and only M matched:
            //   - high match rate (>= 60%) -> the page is well-formed
            //     and matching works; the small number of unmatched
            //     entries are genuinely new / unusual / renamed.
            //     It is safe to reset unmatched current-team players
            //     to Unsigned (they left the team).
            //   - low match rate (< 60%) -> something is wrong with
            //     the page or with the matching (page structure
            //     changed, rate-limited partial response, name
            //     encoding change). Abort BEFORE resetting anyone,
            //     and throw so the outer loop records the failure
            //     and rolls back the transaction.
            // ---------------------------------------------------------

            var totalEntries = playerLinks.Count;
            var matchedEntries = matchResults.Count(m => m.Player != null);
            var matchRate = (double)matchedEntries / totalEntries;

            const double MinimumAcceptableMatchRate = 0.60;

            if (matchRate < MinimumAcceptableMatchRate)
            {
                throw new InvalidOperationException(
                    $"CapFreeze match rate for {teamSlug} was only " +
                    $"{matchedEntries}/{totalEntries} " +
                    $"({matchRate:P0}). Aborting to avoid wiping " +
                    "player statuses. Check the CapFreeze page structure " +
                    "and the matching service.");
            }

            // Match rate is acceptable. It is now safe to reset the
            // collected candidates to Unsigned. Players that do not
            // appear on the CapFreeze page below are genuinely no
            // longer on this team; players that do appear will be
            // re-assigned by the matching loop.
            foreach (var p in playersToResetIfUnmatched)
            {
                p.Status = PlayerStatus.Unsigned;
            }

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
            //
            // Read-only metadata: AsNoTracking so the 32 team rows are
            // not re-tracked on every iteration of the loop below.
            // ---------------------------------------------------------

            var teams =
                await _dbContext.NhlTeams
                    .AsNoTracking()
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
            //
            // After every team we clear the ChangeTracker so that the
            // 32nd team's sync does not carry the tracked entities of
            // the previous 31 teams. Without this, a full run keeps
            // growing its memory footprint until the request ends.
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
                finally
                {
                    // Free every tracked entity from this iteration.
                    // Safe to call whether the transaction committed or
                    // rolled back: in both cases anything we care about
                    // has already been written (or explicitly not
                    // written) to the database.
                    _dbContext.ChangeTracker.Clear();
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

            // NOTE: must stay tracked. We set player.Status below and
            // rely on the final SaveChangesAsync to persist it.
            var players =
                await _dbContext.Players
                    .Where(p => nhlPlayerIds.Contains(p.NhlPlayerId))
                    .ToListAsync();

            var databasePlayerIds =
                players.Select(p => p.Id).ToList();

            // Read-only projection: AsNoTracking is safe.
            var playerIdsWithContracts =
                (await _dbContext.PlayerContracts
                    .AsNoTracking()
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