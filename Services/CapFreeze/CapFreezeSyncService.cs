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

            var teamPlayerIds =
                teamPlayers.Select(p => p.Id).Distinct().ToList();

            var preloadedContracts =
                await _dbContext.PlayerContracts
                    .Where(c => teamPlayerIds.Contains(c.PlayerId))
                    .GroupBy(c => c.PlayerId)
                    .ToDictionaryAsync(
                        g => g.Key,
                        g => g.ToList());

            var existingReviews =
                await _dbContext.CapFreezePlayerReviews.ToListAsync();

            var reviewLookup =
                new Dictionary<(string CapFreezeName, int PlayerId), CapFreezePlayerReview>();

            foreach (var review in existingReviews)
                reviewLookup.TryAdd((review.CapFreezeName, review.PlayerId), review);

            var normalizedDeadCapNames =
                deadCap
                    .Select(_capFreezeMatchingService.NormalizePlayerName)
                    .ToHashSet();

            var playersToResetIfUnmatched = new List<Player>();

            foreach (var player in currentTeamPlayers)
            {
                // Manually managed: never touch this player.
                if (player.SkipCapFreezeSync)
                {
                    continue;
                }

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

            foreach (var p in playersToResetIfUnmatched)
            {
                p.Status = PlayerStatus.Unsigned;
            }

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

                // Manually managed: do not update anything about this
                // player — not status, not CapFreezeName, not slug,
                // not contracts. The commissioner owns this record.
                if (player.SkipCapFreezeSync)
                {
                    skippedManualPlayers.Add(
                        $"{player.FirstName} {player.LastName} " +
                        $"(NhlPlayerId {player.NhlPlayerId})");

                    continue;
                }

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

            var successfulTeams =
                new List<object>();

            var failedTeams =
                new List<object>();

            var runStartedUtc = DateTime.UtcNow;

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
                    _dbContext.ChangeTracker.Clear();
                }
            }

            return new
            {
                TotalTeams = teams.Count,
                SuccessfulTeamsCount = successfulTeams.Count,
                FailedTeamsCount = failedTeams.Count,
                SuccessfulTeams = successfulTeams,
                FailedTeams = failedTeams
            };
        }
    }
}