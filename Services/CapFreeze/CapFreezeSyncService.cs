using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.CapFreeze
{
    public class CapFreezeSyncService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;
        private readonly CapFreezePageService _capFreezePageService;
        private readonly CapFreezeMatchingService _capFreezeMatchingService;
        private readonly CapFreezeContractService _capFreezeContractService;

        private static readonly HashSet<int> ProtectedStatusPlayerIds = new()
{
        2237,
        2241
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
    HttpClient httpClient,
    AppDbContext dbContext,
    CapFreezePageService capFreezePageService,
    CapFreezeMatchingService capFreezeMatchingService,
    CapFreezeContractService capFreezeContractService)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _capFreezePageService = capFreezePageService;
            _capFreezeMatchingService = capFreezeMatchingService;
            _capFreezeContractService = capFreezeContractService;
        }

        public async Task<object> SyncCapFreezeTeamAsync(
string teamSlug,
int nhlTeamId)
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(teamSlug);

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

            var deadCap =
                _capFreezePageService.ExtractCapFreezeSectionPlayers(
                    html,
                    "Dead Cap");

            var playerLinks =
                new List<(CapFreezePlayerLink Player, PlayerStatus Status)>();

            foreach (var player in forwards)
                playerLinks.Add(
                    (player, PlayerStatus.Rostered));

            foreach (var player in defense)
                playerLinks.Add(
                    (player, PlayerStatus.Rostered));

            foreach (var player in goalies)
                playerLinks.Add(
                    (player, PlayerStatus.Rostered));

            foreach (var player in minors)
                playerLinks.Add(
                    (player, PlayerStatus.FarmPlayer));

            foreach (var player in unsignedRfas)
                playerLinks.Add(
                    (player, PlayerStatus.RFA));

            // ---------------------------------------------------------
            // LOAD CURRENT + PREVIOUS TEAM PLAYERS IN ONE QUERY
            // ---------------------------------------------------------

            var teamPlayers =
                await _dbContext.Players
                    .Where(p =>
                        p.NhlTeamId == nhlTeamId ||
                        p.PreviousNhlTeamId == nhlTeamId)
                    .ToListAsync();

            var currentTeamPlayers =
                teamPlayers
                    .Where(p =>
                        p.NhlTeamId == nhlTeamId)
                    .ToList();

            var previousTeamPlayers =
                teamPlayers
                    .Where(p =>
                        p.PreviousNhlTeamId == nhlTeamId &&
                        !string.IsNullOrWhiteSpace(p.FirstName) &&
                        !string.IsNullOrWhiteSpace(p.LastName))
                    .ToList();

            // ---------------------------------------------------------
            // PRELOAD EXISTING CONTRACTS
            // ---------------------------------------------------------

            var teamPlayerIds =
                currentTeamPlayers
                    .Select(p => p.Id)
                    .Concat(
                        previousTeamPlayers.Select(p => p.Id))
                    .Distinct()
                    .ToList();

            var preloadedContracts =
                await _dbContext.PlayerContracts
                    .Where(c =>
                        teamPlayerIds.Contains(c.PlayerId))
                    .GroupBy(c => c.PlayerId)
                    .ToDictionaryAsync(
                        g => g.Key,
                        g => g.ToList());

            // ---------------------------------------------------------
            // PRELOAD CAPFREEZE REVIEWS
            // ---------------------------------------------------------

            var preloadedReviews =
                await _dbContext.CapFreezePlayerReviews
                    .Where(r =>
                        teamPlayerIds.Contains(r.PlayerId))
                    .ToListAsync();

            var reviewLookup =
                preloadedReviews
                    .ToDictionary(
                        r => (
                            r.CapFreezeName,
                            r.PlayerId));

            // ---------------------------------------------------------
            // MARK CURRENT PLAYERS AS UNSIGNED FIRST.
            //
            // Players actually found on CapFreeze will be assigned
            // their real status below.
            //
            // Protected players are NOT changed automatically.
            // ---------------------------------------------------------

            var normalizedDeadCapNames =
                deadCap
                    .Select(_capFreezeMatchingService.NormalizePlayerName)
                    .ToHashSet();

            foreach (var player in currentTeamPlayers)
            {
                var isProtectedStatusPlayer =
                    ProtectedStatusPlayerIds.Contains(
                        player.Id);

                if (isProtectedStatusPlayer)
                    continue;

                var normalizedOfficialName =
                    _capFreezeMatchingService.NormalizePlayerName(
                        $"{player.FirstName} {player.LastName}");

                var normalizedCapFreezeName =
                    string.IsNullOrWhiteSpace(player.CapFreezeName)
                        ? string.Empty
                        : _capFreezeMatchingService.NormalizePlayerName(
                            player.CapFreezeName!);

                var isDeadCap =
                    normalizedDeadCapNames.Contains(
                        normalizedOfficialName)
                    ||
                    (
                        !string.IsNullOrWhiteSpace(
                            normalizedCapFreezeName)
                        &&
                        normalizedDeadCapNames.Contains(
                            normalizedCapFreezeName)
                    );

                if (isDeadCap)
                    continue;

                player.Status =
                    PlayerStatus.Unsigned;
            }

            var processedPlayers =
                new List<object>();

            var unmatchedPlayers =
                new List<string>();

            // ---------------------------------------------------------
            // PROCESS EVERY CAPFREEZE PLAYER
            // ---------------------------------------------------------

            foreach (var entry in playerLinks)
            {
                var capFreezeName =
                    entry.Player.Name;

                var capFreezeSlug =
                    entry.Player.Slug;

                var status =
                    entry.Status;

                var player =
                    await _capFreezeMatchingService.FindAndRecordCapFreezePlayerMatchAsync(
                        capFreezeName,
                        entry.Player.Position,
                        nhlTeamId,
                        false,
                        currentTeamPlayers,
                        previousTeamPlayers,
                        reviewLookup);

                // -----------------------------------------------------
                // No DB player could be matched.
                // -----------------------------------------------------

                if (player == null)
                {
                    unmatchedPlayers.Add(
                        capFreezeName);

                    continue;
                }

                // -----------------------------------------------------
                // Determine whether this was an exact name match.
                // -----------------------------------------------------

                var normalizedCapFreezeName =
                    _capFreezeMatchingService.NormalizePlayerName(
                        capFreezeName);

                var normalizedDatabaseName =
                    _capFreezeMatchingService.NormalizePlayerName(
                        $"{player.FirstName} {player.LastName}");

                var namesMatch =
                    normalizedCapFreezeName ==
                    normalizedDatabaseName;

                // -----------------------------------------------------
                // Fuzzy/alias matches are still recorded for review.
                // The review does NOT block contract synchronization.
                // -----------------------------------------------------

                var isReviewed = false;

                if (!namesMatch)
                {
                    var reviewKey =
                        (
                            capFreezeName,
                            player.Id
                        );

                    if (reviewLookup.TryGetValue(
                            reviewKey,
                            out var review))
                    {
                        isReviewed =
                            review.IsReviewed;
                    }

                    if (!isReviewed)
                    {
                        unmatchedPlayers.Add(
                            capFreezeName);
                    }
                }
                else
                {
                    isReviewed = true;
                }

                // -----------------------------------------------------
                // Successfully matched player.
                //
                // Protected players 2237 and 2241 keep their existing
                // status permanently and are never changed automatically.
                //
                // All other successfully matched players receive the
                // CapFreeze status and status timestamp.
                // -----------------------------------------------------

                var isProtectedStatusPlayer =
                    ProtectedStatusPlayerIds.Contains(
                        player.Id);

                if (!isProtectedStatusPlayer)
                {
                    player.Status =
                        status;

                    player.CapFreezeStatusLastUpdated =
                        DateTime.UtcNow;
                }

                // -----------------------------------------------------
                // CONTRACTS
                //
                // Every non-RFA gets its contract synchronized.
                //
                // Fuzzy matches are NOT blocked by review status.
                // -----------------------------------------------------

                var shouldSyncContract =
                    status != PlayerStatus.RFA;

                if (shouldSyncContract)
                {
                    await _capFreezeContractService.SyncPlayerContractsAsync(
                        player.Id,
                        capFreezeSlug,
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

                        CapFreezeName =
                            player.CapFreezeName,

                        CapFreezeSlug =
                            capFreezeSlug,

                        Status =
                            player.Status.ToString(),

                        ContractSynchronized =
                            shouldSyncContract,

                        player.CapFreezeStatusLastUpdated,
                        player.CapFreezeContractLastUpdated,

                        player.NhlTeamId,
                        player.PreviousNhlTeamId
                    });
            }

            // ---------------------------------------------------------
            // SAVE EVERYTHING ONCE AT THE END
            // ---------------------------------------------------------

            await _dbContext.SaveChangesAsync();

            return new
            {
                TeamSlug = teamSlug,

                NhlTeamId = nhlTeamId,

                ForwardsCount =
                    forwards.Count,

                DefenseCount =
                    defense.Count,

                GoaliesCount =
                    goalies.Count,

                MinorsCount =
                    minors.Count,

                UnsignedRfasCount =
                    unsignedRfas.Count,

                TotalPlayersFound =
                    playerLinks.Count,

                PlayersProcessed =
                    processedPlayers.Count,

                UnmatchedPlayers =
                    unmatchedPlayers,

                Players =
                    processedPlayers
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

            // ---------------------------------------------------------
            // SYNC EACH TEAM SEQUENTIALLY
            //
            // Each team gets its own transaction.
            //
            // If a team fails:
            // - its database changes are rolled back
            // - all tracked entities are detached
            // - the next team starts cleanly
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
                            team.NhlTeamId);

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
                    // -------------------------------------------------
                    // ROLLBACK DATABASE CHANGES FOR THIS TEAM
                    // -------------------------------------------------

                    try
                    {
                        await transaction.RollbackAsync();
                    }
                    catch
                    {
                        // Preserve the original synchronization error.
                    }

                    // -------------------------------------------------
                    // CLEAR ALL TRACKED ENTITIES
                    //
                    // A transaction rollback only rolls back the
                    // database. EF Core can still have modified,
                    // added, or deleted entities in its ChangeTracker.
                    //
                    // Detaching them ensures that a later team's
                    // SaveChangesAsync() cannot accidentally persist
                    // changes belonging to this failed team.
                    // -------------------------------------------------

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
            // RETURN COMPLETE SYNC SUMMARY
            // ---------------------------------------------------------

            return new
            {
                TotalTeams =
                    teams.Count,

                SuccessfulTeamsCount =
                    successfulTeams.Count,

                FailedTeamsCount =
                    failedTeams.Count,

                SuccessfulTeams =
                    successfulTeams,

                FailedTeams =
                    failedTeams
            };
        }
    }
}
