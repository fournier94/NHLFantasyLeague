using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.CapFreeze;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.CapFreeze
{
    public class CapFreezeMatchingService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public CapFreezeMatchingService(
    HttpClient httpClient,
    AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
        }

        public async Task<Player?> FindPlayerByCapFreezeNameAsync(
string capFreezeName)
        {
            var normalizedName =
                NormalizePlayerName(capFreezeName);

            var players = await _dbContext.Players
                .Where(p => p.CapFreezeName != null)
                .ToListAsync();

            return players.FirstOrDefault(p =>
                NormalizePlayerName(p.CapFreezeName!) == normalizedName);
        }

        public async Task<Player?> FindAndRecordCapFreezePlayerMatchAsync(
string capFreezeName,
string capFreezePosition,
int nhlTeamId,
bool saveChanges = true,
List<Player>? currentTeamPlayers = null,
List<Player>? previousTeamPlayers = null,
Dictionary<(string CapFreezeName, int PlayerId), CapFreezePlayerReview>? preloadedReviews = null)
        {
            var normalizedCapFreezeName =
                NormalizePlayerName(capFreezeName);

            var normalizedPosition =
                capFreezePosition
                    .Trim()
                    .ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(normalizedCapFreezeName))
                return null;

            // ---------------------------------------------------------
            // STEP 1:
            // Find players currently belonging to this NHL team.
            // ---------------------------------------------------------

            currentTeamPlayers ??= await _dbContext.Players
                .Where(p =>
                    p.NhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // ---------------------------------------------------------
            // STEP 2:
            // Exact official NHL name match on current team.
            // ---------------------------------------------------------

            var currentOfficialNameMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName
                    &&
                    (
                        string.IsNullOrWhiteSpace(normalizedPosition)
                        ||
                        p.Position
                            .ToUpperInvariant()
                            .Contains(normalizedPosition)
                    ));

            if (currentOfficialNameMatch != null)
            {
                currentOfficialNameMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return currentOfficialNameMatch;
            }

            // ---------------------------------------------------------
            // STEP 3:
            // Existing CapFreeze alias match on current team.
            // ---------------------------------------------------------

            var currentAliasMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (currentAliasMatch != null)
            {
                currentAliasMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return currentAliasMatch;
            }

            // ---------------------------------------------------------
            // STEP 4:
            // Find players who previously belonged to this NHL team.
            // ---------------------------------------------------------

            previousTeamPlayers ??= await _dbContext.Players
                .Where(p =>
                    p.PreviousNhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // ---------------------------------------------------------
            // STEP 5:
            // Exact official name match among previous players.
            // ---------------------------------------------------------

            var previousOfficialNameMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName
                    &&
                    (
                        string.IsNullOrWhiteSpace(normalizedPosition)
                        ||
                        p.Position
                            .ToUpperInvariant()
                            .Contains(normalizedPosition)
                    ));

            if (previousOfficialNameMatch != null)
            {
                previousOfficialNameMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return previousOfficialNameMatch;
            }

            // ---------------------------------------------------------
            // STEP 6:
            // Existing CapFreeze alias match among previous players.
            // ---------------------------------------------------------

            var previousAliasMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (previousAliasMatch != null)
            {
                previousAliasMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return previousAliasMatch;
            }

            // ---------------------------------------------------------
            // STEP 7:
            // No exact match.
            // Combine current + previous team players and fuzzy match.
            // ---------------------------------------------------------

            var candidatePlayers =
                currentTeamPlayers
                    .Concat(previousTeamPlayers)
                    .GroupBy(p => p.Id)
                    .Select(g => g.First())
                    .ToList();

            if (candidatePlayers.Count == 0)
                return null;

            var parts =
                capFreezeName.Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 2)
                return null;

            var capFreezeFirstName =
                parts[0];

            var capFreezeLastName =
                string.Join(
                    " ",
                    parts.Skip(1));

            var normalizedCapFreezeFirstName =
                NormalizePlayerName(capFreezeFirstName);

            var normalizedCapFreezeLastName =
                NormalizePlayerName(capFreezeLastName);

            var matches =
                candidatePlayers
                    .Select(player =>
                    {
                        var normalizedDatabaseFirstName =
                            NormalizePlayerName(player.FirstName);

                        var normalizedDatabaseLastName =
                            NormalizePlayerName(player.LastName);

                        var normalizedDatabaseFullName =
                            NormalizePlayerName(
                                $"{player.FirstName} {player.LastName}");

                        return new
                        {
                            Player = player,

                            FirstNameSimilarity =
                                CalculateSimilarity(
                                    normalizedCapFreezeFirstName,
                                    normalizedDatabaseFirstName),

                            LastNameSimilarity =
                                CalculateSimilarity(
                                    normalizedCapFreezeLastName,
                                    normalizedDatabaseLastName),

                            FullNameSimilarity =
                                CalculateSimilarity(
                                    normalizedCapFreezeName,
                                    normalizedDatabaseFullName)
                        };
                    })
                    .OrderByDescending(x => x.FullNameSimilarity)
                    .ThenByDescending(x => x.LastNameSimilarity)
                    .ThenByDescending(x => x.FirstNameSimilarity)
                    .ToList();

            // ---------------------------------------------------------
            // STEP 8:
            // Always use the highest-similarity candidate.
            //
            // There is intentionally NO similarity threshold.
            // ---------------------------------------------------------

            var bestMatch =
                matches.First();

            // ---------------------------------------------------------
            // STEP 9:
            // Save CapFreeze name on matched player.
            // ---------------------------------------------------------

            bestMatch.Player.CapFreezeName =
                capFreezeName;

            // ---------------------------------------------------------
            // STEP 10:
            // Check for an existing review.
            // ---------------------------------------------------------

            CapFreezePlayerReview? existingReview = null;

            var reviewKey =
                (
                    capFreezeName,
                    bestMatch.Player.Id
                );

            if (preloadedReviews != null)
            {
                preloadedReviews.TryGetValue(
                    reviewKey,
                    out existingReview);
            }
            else
            {
                existingReview =
                    await _dbContext.CapFreezePlayerReviews
                        .FirstOrDefaultAsync(r =>
                            r.CapFreezeName == capFreezeName &&
                            r.PlayerId == bestMatch.Player.Id);
            }

            // ---------------------------------------------------------
            // STEP 11:
            // Create review if one does not already exist.
            //
            // The review is informational only.
            // It does NOT prevent contract synchronization.
            // ---------------------------------------------------------

            if (existingReview == null)
            {
                var review =
                    new CapFreezePlayerReview
                    {
                        CapFreezeName =
                            capFreezeName,

                        PlayerId =
                            bestMatch.Player.Id,

                        FullNameSimilarity =
                            bestMatch.FullNameSimilarity,

                        FirstNameSimilarity =
                            bestMatch.FirstNameSimilarity,

                        LastNameSimilarity =
                            bestMatch.LastNameSimilarity,

                        NhlTeamId =
                            nhlTeamId,

                        IsReviewed =
                            false,

                        IsApproved =
                            null
                    };

                _dbContext.CapFreezePlayerReviews.Add(review);

                if (preloadedReviews != null)
                {
                    preloadedReviews[reviewKey] =
                        review;
                }
            }

            if (saveChanges)
            {
                await _dbContext.SaveChangesAsync();
            }

            return bestMatch.Player;
        }

        public async Task<string> TestFindTeamPlayerMatchesAsync(
string capFreezeName,
int nhlTeamId)
        {
            var players = await _dbContext.Players
                .Where(p =>
                    p.NhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            if (players.Count == 0)
                return "No players found for this NHL team.";

            var parts = capFreezeName
                .Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 2)
                return "Could not split player name.";

            var capFreezeFirstName = parts[0];

            var capFreezeLastName = string.Join(
                " ",
                parts.Skip(1));

            var normalizedCapFreezeFirstName =
                NormalizePlayerName(capFreezeFirstName);

            var normalizedCapFreezeLastName =
                NormalizePlayerName(capFreezeLastName);

            var normalizedCapFreezeFullName =
                NormalizePlayerName(capFreezeName);

            var matches = players
                .Select(player =>
                {
                    var normalizedDatabaseFirstName =
                        NormalizePlayerName(player.FirstName);

                    var normalizedDatabaseLastName =
                        NormalizePlayerName(player.LastName);

                    var normalizedDatabaseFullName =
                        NormalizePlayerName(
                            $"{player.FirstName} {player.LastName}");

                    return new
                    {
                        player.Id,
                        player.NhlPlayerId,
                        player.FirstName,
                        player.LastName,
                        player.NhlTeamId,

                        FirstNameSimilarity =
                            CalculateSimilarity(
                                normalizedCapFreezeFirstName,
                                normalizedDatabaseFirstName),

                        LastNameSimilarity =
                            CalculateSimilarity(
                                normalizedCapFreezeLastName,
                                normalizedDatabaseLastName),

                        FullNameSimilarity =
                            CalculateSimilarity(
                                normalizedCapFreezeFullName,
                                normalizedDatabaseFullName)
                    };
                })
                .OrderByDescending(x => x.FullNameSimilarity)
                .ThenByDescending(x => x.LastNameSimilarity)
                .ThenByDescending(x => x.FirstNameSimilarity)
                .Take(5)
                .ToList();

            return System.Text.Json.JsonSerializer.Serialize(
                new
                {
                    CapFreezeName = capFreezeName,
                    NhlTeamId = nhlTeamId,
                    CandidateCount = players.Count,
                    Matches = matches
                });
        }

        public async Task<object?> TestCapFreezeMatchPathAsync(
string capFreezeName,
int nhlTeamId)
        {
            var normalizedCapFreezeName =
                NormalizePlayerName(capFreezeName);

            // ---------------------------------------------------------
            // CURRENT TEAM
            // ---------------------------------------------------------

            var currentTeamPlayers = await _dbContext.Players
                .Where(p =>
                    p.NhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // Current team - official name
            var currentOfficialMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName);

            if (currentOfficialMatch != null)
            {
                return new
                {
                    MatchType = "CurrentTeam_OfficialName",
                    currentOfficialMatch.Id,
                    currentOfficialMatch.NhlPlayerId,
                    currentOfficialMatch.FirstName,
                    currentOfficialMatch.LastName,
                    currentOfficialMatch.NhlTeamId,
                    currentOfficialMatch.PreviousNhlTeamId,
                    currentOfficialMatch.CapFreezeName
                };
            }

            // Current team - saved CapFreezeName
            var currentAliasMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (currentAliasMatch != null)
            {
                return new
                {
                    MatchType = "CurrentTeam_CapFreezeName",
                    currentAliasMatch.Id,
                    currentAliasMatch.NhlPlayerId,
                    currentAliasMatch.FirstName,
                    currentAliasMatch.LastName,
                    currentAliasMatch.NhlTeamId,
                    currentAliasMatch.PreviousNhlTeamId,
                    currentAliasMatch.CapFreezeName
                };
            }

            // ---------------------------------------------------------
            // PREVIOUS TEAM
            // ---------------------------------------------------------

            var previousTeamPlayers = await _dbContext.Players
                .Where(p =>
                    p.PreviousNhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // Previous team - official name
            var previousOfficialMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName);

            if (previousOfficialMatch != null)
            {
                return new
                {
                    MatchType = "PreviousTeam_OfficialName",
                    previousOfficialMatch.Id,
                    previousOfficialMatch.NhlPlayerId,
                    previousOfficialMatch.FirstName,
                    previousOfficialMatch.LastName,
                    previousOfficialMatch.NhlTeamId,
                    previousOfficialMatch.PreviousNhlTeamId,
                    previousOfficialMatch.CapFreezeName
                };
            }

            // Previous team - saved CapFreezeName
            var previousAliasMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (previousAliasMatch != null)
            {
                return new
                {
                    MatchType = "PreviousTeam_CapFreezeName",
                    previousAliasMatch.Id,
                    previousAliasMatch.NhlPlayerId,
                    previousAliasMatch.FirstName,
                    previousAliasMatch.LastName,
                    previousAliasMatch.NhlTeamId,
                    previousAliasMatch.PreviousNhlTeamId,
                    previousAliasMatch.CapFreezeName
                };
            }

            return new
            {
                MatchType = "NoExactOrAliasMatch",
                CurrentTeamCandidateCount = currentTeamPlayers.Count,
                PreviousTeamCandidateCount = previousTeamPlayers.Count
            };
        }

        public string NormalizePlayerName(string name)
        {
            var normalized = name
                .Normalize(
                    System.Text.NormalizationForm.FormD);

            var characters = normalized
                .Where(c =>
                    System.Globalization.CharUnicodeInfo
                        .GetUnicodeCategory(c)
                    != System.Globalization.UnicodeCategory.NonSpacingMark)
                .ToArray();

            return new string(characters)
                .Normalize(
                    System.Text.NormalizationForm.FormC)
                .ToLowerInvariant()
                .Replace("-", "")
                .Replace("'", "")
                .Replace(" ", "");
        }

        private double CalculateSimilarity(
string first,
string second)
        {
            if (first == second)
                return 1.0;

            var distance = LevenshteinDistance(
                first,
                second);

            var maxLength =
                Math.Max(first.Length, second.Length);

            if (maxLength == 0)
                return 1.0;

            return 1.0 -
                   ((double)distance / maxLength);
        }

        private int LevenshteinDistance(
string first,
string second)
        {
            var matrix =
                new int[first.Length + 1, second.Length + 1];

            for (var i = 0; i <= first.Length; i++)
                matrix[i, 0] = i;

            for (var j = 0; j <= second.Length; j++)
                matrix[0, j] = j;

            for (var i = 1; i <= first.Length; i++)
            {
                for (var j = 1; j <= second.Length; j++)
                {
                    var cost =
                        first[i - 1] == second[j - 1]
                            ? 0
                            : 1;

                    matrix[i, j] = Math.Min(
                        Math.Min(
                            matrix[i - 1, j] + 1,
                            matrix[i, j - 1] + 1),
                        matrix[i - 1, j - 1] + cost);
                }
            }

            return matrix[
                first.Length,
                second.Length];
        }
    }
}
