using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.CapFreeze;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.NHL;
using System.Net.Http;
using System.Globalization;
using System.Text;

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

        // =====================================================================
        // NEW MATCHING ENGINE
        // =====================================================================

        private const double AutoAcceptLast = 0.97;
        private const double AutoAcceptFirst = 0.92;
        private const double MinLeadOverRunnerUp = 0.05;

        private sealed class PlayerNameInfo
        {
            public Player Player { get; set; } = null!;
            public string Last { get; set; } = "";
            public string FullKey { get; set; } = "";
            public HashSet<string> FirstVariants { get; set; } = new();
        }

        private sealed class EntryNameInfo
        {
            public string FullKey { get; set; } = "";
            public List<(HashSet<string> FirstVariants, string Last)> Splits { get; } = new();
        }

        private sealed class ScoredPair
        {
            public int ResultIndex { get; set; }
            public PlayerNameInfo Candidate { get; set; } = null!;
            public double Score { get; set; }
            public double First { get; set; }
            public double Last { get; set; }
        }

        /// <summary>
        /// Matches every CapFreeze entry of ONE team page to a player in the DB.
        /// Order of operations (each step only handles entries still unresolved,
        /// and a DB player can only be claimed once):
        ///   0. saved slug / approved review
        ///   1. exact name on the team
        ///   2. nickname / fuzzy on the team
        ///   3. whole database (strict)
        /// Anything else stays unmatched. Uncertain candidates go to the review table.
        /// </summary>
        public List<CapFreezeMatchResult> MatchCapFreezeTeamEntries(
            List<CapFreezePlayerLink> entries,
            int nhlTeamId,
            List<Player> allPlayers,
            Dictionary<(string CapFreezeName, int PlayerId), CapFreezePlayerReview> reviewLookup)
        {
            var results = entries
                .Select(e => new CapFreezeMatchResult { Entry = e })
                .ToList();

            var entryInfos = entries.Select(BuildEntryNameInfo).ToList();

            var allInfos = allPlayers
                .Where(p =>
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .Select(BuildPlayerNameInfo)
                .ToList();

            var teamInfos = allInfos
                .Where(i =>
                    i.Player.NhlTeamId == nhlTeamId ||
                    i.Player.PreviousNhlTeamId == nhlTeamId)
                .ToList();

            var claimed = new HashSet<int>();

            var rejectedPairs = new HashSet<(string, int)>(
                reviewLookup.Values
                    .Where(r => r.IsReviewed && r.IsApproved == false)
                    .Select(r => (r.CapFreezeName, r.PlayerId)));

            // -------------------------------------------------------------
            // PASS 0a: saved slug (works even if the player changed team)
            // -------------------------------------------------------------
            var playersBySlug = new Dictionary<string, Player>(StringComparer.OrdinalIgnoreCase);

            foreach (var p in allPlayers)
            {
                if (!string.IsNullOrWhiteSpace(p.CapFreezeSlug))
                    playersBySlug.TryAdd(p.CapFreezeSlug!, p);
            }

            for (var i = 0; i < results.Count; i++)
            {
                var slug = results[i].Entry.Slug;

                if (!string.IsNullOrWhiteSpace(slug) &&
                    playersBySlug.TryGetValue(slug, out var linked) &&
                    claimed.Add(linked.Id))
                {
                    results[i].Player = linked;
                    results[i].MatchType = "SavedSlug";
                }
            }

            // -------------------------------------------------------------
            // PASS 0b: reviews you approved manually
            // -------------------------------------------------------------
            var playersById = allPlayers.ToDictionary(p => p.Id);

            foreach (var review in reviewLookup.Values.Where(r => r.IsApproved == true))
            {
                if (!playersById.TryGetValue(review.PlayerId, out var approvedPlayer))
                    continue;

                for (var i = 0; i < results.Count; i++)
                {
                    if (results[i].Player == null &&
                        results[i].Entry.Name == review.CapFreezeName &&
                        claimed.Add(approvedPlayer.Id))
                    {
                        results[i].Player = approvedPlayer;
                        results[i].MatchType = "ApprovedReview";
                        break;
                    }
                }
            }

            // -------------------------------------------------------------
            // PASS 1: exact names on this team
            // PASS 2: nicknames / fuzzy on this team
            // PASS 3: whole database, stricter gates
            // -------------------------------------------------------------
            RunMatchingPass(results, entryInfos, teamInfos, claimed, rejectedPairs,
                nhlTeamId, "TeamExact", lastGate: 1.0, firstGate: 1.0, exactOnly: true);

            RunMatchingPass(results, entryInfos, teamInfos, claimed, rejectedPairs,
                nhlTeamId, "TeamFuzzy", lastGate: 0.90, firstGate: 0.85, exactOnly: false);

            RunMatchingPass(results, entryInfos, allInfos, claimed, rejectedPairs,
                nhlTeamId, "WholeDatabase", lastGate: 0.95, firstGate: 0.90, exactOnly: false);

            // -------------------------------------------------------------
            // Uncertain candidates -> review table (NOT applied to the player)
            // -------------------------------------------------------------
            foreach (var result in results)
            {
                if (result.Player != null || result.ReviewCandidate == null)
                    continue;

                if (claimed.Contains(result.ReviewCandidate.Id))
                {
                    result.ReviewCandidate = null;
                    continue;
                }

                var key = (result.Entry.Name, result.ReviewCandidate.Id);

                if (reviewLookup.ContainsKey(key))
                    continue;

                var newReview = new CapFreezePlayerReview
                {
                    CapFreezeName = result.Entry.Name,
                    PlayerId = result.ReviewCandidate.Id,
                    FullNameSimilarity = result.ReviewFullSimilarity,
                    FirstNameSimilarity = result.ReviewFirstSimilarity,
                    LastNameSimilarity = result.ReviewLastSimilarity,
                    NhlTeamId = nhlTeamId,
                    IsReviewed = false,
                    IsApproved = null
                };

                _dbContext.CapFreezePlayerReviews.Add(newReview);
                reviewLookup[key] = newReview;
            }

            return results;
        }

        private static void RunMatchingPass(
            List<CapFreezeMatchResult> results,
            List<EntryNameInfo> entryInfos,
            List<PlayerNameInfo> candidates,
            HashSet<int> claimed,
            HashSet<(string, int)> rejectedPairs,
            int nhlTeamId,
            string passName,
            double lastGate,
            double firstGate,
            bool exactOnly)
        {
            var pairs = new List<ScoredPair>();

            for (var i = 0; i < results.Count; i++)
            {
                if (results[i].Player != null)
                    continue;

                var entry = results[i].Entry;

                foreach (var candidate in candidates)
                {
                    if (claimed.Contains(candidate.Player.Id))
                        continue;

                    if (rejectedPairs.Contains((entry.Name, candidate.Player.Id)))
                        continue;

                    if (!PositionsCompatible(entry.Position, candidate.Player.Position))
                        continue;

                    var (first, last) = ScoreNames(entryInfos[i], candidate);

                    if (last < lastGate || first < firstGate)
                        continue;

                    if (exactOnly && (first < 1.0 || last < 1.0))
                        continue;

                    var score = 0.6 * last + 0.4 * first;

                    if (candidate.Player.NhlTeamId == nhlTeamId)
                        score += 0.02;

                    pairs.Add(new ScoredPair
                    {
                        ResultIndex = i,
                        Candidate = candidate,
                        Score = score,
                        First = first,
                        Last = last
                    });
                }
            }

            // Best pairs first, so strong matches always claim players before weak ones.
            foreach (var pair in pairs.OrderByDescending(p => p.Score))
            {
                var result = results[pair.ResultIndex];

                if (result.Player != null || claimed.Contains(pair.Candidate.Player.Id))
                    continue;

                var runnerUp = pairs
                    .Where(p =>
                        p.ResultIndex == pair.ResultIndex &&
                        p.Candidate.Player.Id != pair.Candidate.Player.Id &&
                        !claimed.Contains(p.Candidate.Player.Id))
                    .Select(p => p.Score)
                    .DefaultIfEmpty(0)
                    .Max();

                var clearLead = pair.Score - runnerUp >= MinLeadOverRunnerUp;
                var strong = pair.Last >= AutoAcceptLast && pair.First >= AutoAcceptFirst;

                if (strong && clearLead)
                {
                    result.Player = pair.Candidate.Player;
                    result.MatchType = passName;
                    claimed.Add(pair.Candidate.Player.Id);
                }
                else if (result.ReviewCandidate == null ||
                         claimed.Contains(result.ReviewCandidate.Id))
                {
                    result.ReviewCandidate = pair.Candidate.Player;
                    result.ReviewFirstSimilarity = pair.First;
                    result.ReviewLastSimilarity = pair.Last;
                    result.ReviewFullSimilarity =
                        JaroWinkler(entryInfos[pair.ResultIndex].FullKey, pair.Candidate.FullKey);
                }
            }
        }

        private static (double First, double Last) ScoreNames(
            EntryNameInfo entry,
            PlayerNameInfo player)
        {
            double bestFirst = 0;
            double bestLast = 0;
            double bestCombined = -1;

            // The CapFreeze name can be split at several points
            // ("Tinus Luc Koblar" -> "Tinus | Luc Koblar" or "Tinus Luc | Koblar").
            foreach (var split in entry.Splits)
            {
                var last = JaroWinkler(split.Last, player.Last);

                if (last < 0.80)
                    continue;

                var first = BestFirstNameScore(split.FirstVariants, player.FirstVariants);
                var combined = 0.6 * last + 0.4 * first;

                if (combined > bestCombined)
                {
                    bestCombined = combined;
                    bestFirst = first;
                    bestLast = last;
                }
            }

            return (bestFirst, bestLast);
        }

        private static double BestFirstNameScore(
            HashSet<string> cfVariants,
            HashSet<string> dbVariants)
        {
            double best = 0;

            foreach (var a in cfVariants)
            {
                foreach (var b in dbVariants)
                {
                    if (a == b)
                        return 1.0;                                  // exact (or same initials: JJ = John-Jason)

                    if (AreNicknames(a, b))
                        best = Math.Max(best, 0.95);                 // zack = zachary
                    else if (a.Length >= 3 && b.Length >= 3 &&
                             (a.StartsWith(b) || b.StartsWith(a)))
                        best = Math.Max(best, 0.92);                 // nick -> nicholas, josh -> joshua
                    else
                        best = Math.Max(best, JaroWinkler(a, b));
                }
            }

            return best;
        }

        private static EntryNameInfo BuildEntryNameInfo(CapFreezePlayerLink entry)
        {
            var tokens = Tokenize(entry.Name);

            var info = new EntryNameInfo
            {
                FullKey = string.Concat(tokens)
            };

            for (var i = 1; i < tokens.Count; i++)
            {
                info.Splits.Add((
                    FirstNameVariants(string.Join(" ", tokens.Take(i))),
                    string.Concat(tokens.Skip(i))));
            }

            return info;
        }

        private static PlayerNameInfo BuildPlayerNameInfo(Player player)
        {
            var firstTokens = Tokenize(player.FirstName);
            var lastTokens = Tokenize(player.LastName);

            return new PlayerNameInfo
            {
                Player = player,
                Last = string.Concat(lastTokens),
                FullKey = string.Concat(firstTokens.Concat(lastTokens)),
                FirstVariants = FirstNameVariants(player.FirstName)
            };
        }

        /// <summary>
        /// "Anthony (AJ)" -> { anthony, aj }
        /// "Jean-Gabriel" -> { jeangabriel, jg }
        /// </summary>
        private static HashSet<string> FirstNameVariants(string? rawFirst)
        {
            var variants = new HashSet<string>();

            void AddFrom(string text)
            {
                var tokens = Tokenize(text);

                if (tokens.Count == 0)
                    return;

                variants.Add(string.Concat(tokens));

                if (tokens.Count > 1)
                    variants.Add(string.Concat(tokens.Select(t => t[0])));
            }

            if (string.IsNullOrWhiteSpace(rawFirst))
                return variants;

            var open = rawFirst.IndexOf('(');
            var close = rawFirst.IndexOf(')');

            if (open >= 0 && close > open)
            {
                AddFrom(rawFirst.Substring(0, open));
                AddFrom(rawFirst.Substring(open + 1, close - open - 1));
            }
            else
            {
                AddFrom(rawFirst);
            }

            return variants;
        }

        private static List<string> Tokenize(string? name)
        {
            if (string.IsNullOrWhiteSpace(name))
                return new List<string>();

            var cleaned = RemoveDiacritics(name)
                .ToLowerInvariant()
                .Replace("'", "")
                .Replace("’", "")
                .Replace(".", "");

            return cleaned
                .Split(new[] { ' ', '-', '(', ')', ',', '\t' }, StringSplitOptions.RemoveEmptyEntries)
                .Where(t => t != "jr" && t != "sr")
                .ToList();
        }

        private static string RemoveDiacritics(string text)
        {
            var prepared = text
                .Replace("ø", "o").Replace("Ø", "O")
                .Replace("æ", "ae").Replace("Æ", "AE")
                .Replace("ł", "l").Replace("Ł", "L")
                .Replace("đ", "d").Replace("Đ", "D")
                .Replace("ß", "ss")
                .Normalize(NormalizationForm.FormD);

            var sb = new StringBuilder();

            foreach (var c in prepared)
            {
                if (CharUnicodeInfo.GetUnicodeCategory(c) != UnicodeCategory.NonSpacingMark)
                    sb.Append(c);
            }

            return sb.ToString().Normalize(NormalizationForm.FormC);
        }

        private static string PositionGroup(string? position)
        {
            var p = (position ?? "").Trim().ToUpperInvariant();

            if (p.Length == 0) return "";
            if (p.Contains('G')) return "G";
            if (p.Contains('D')) return "D";
            if (p.Contains('C') || p.Contains('L') || p.Contains('R') ||
                p.Contains('W') || p.Contains('F')) return "F";

            return "";
        }

        // F / D / G must agree. Unknown position = no opinion.
        private static bool PositionsCompatible(string? a, string? b)
        {
            var ga = PositionGroup(a);
            var gb = PositionGroup(b);

            return ga.Length == 0 || gb.Length == 0 || ga == gb;
        }

        private static readonly Dictionary<string, int> NicknameGroupIds = BuildNicknameMap();

        private static Dictionary<string, int> BuildNicknameMap()
        {
            // Add more groups whenever you find a nickname pair that is missing.
            var groups = new[]
            {
        new[] { "zachary", "zack", "zach", "zac" },
        new[] { "nicholas", "nick", "nico", "nicolas" },
        new[] { "joseph", "joe", "joey" },
        new[] { "matthew", "matt", "matty" },
        new[] { "cameron", "cam" },
        new[] { "alexander", "alexandre", "aleksander", "alex" },
        new[] { "alexei", "alexey", "aleksei", "aleksey" },
        new[] { "artem", "artyom", "artemy" },
        new[] { "benjamin", "ben", "benny" },
        new[] { "william", "will", "bill", "billy", "willy" },
        new[] { "christopher", "chris" },
        new[] { "michael", "mike", "mikey" },
        new[] { "anthony", "tony" },
        new[] { "daniel", "dan", "danny", "danil", "daniil" },
        new[] { "jonathan", "jon", "jonny", "jonathon" },
        new[] { "jacob", "jake" },
        new[] { "ronald", "ronnie", "ron" },
        new[] { "samuel", "sam", "sammy" },
        new[] { "joshua", "josh" },
        new[] { "andrew", "andy", "drew" },
        new[] { "timothy", "tim", "timmy" },
        new[] { "thomas", "tom", "tommy" },
        new[] { "robert", "rob", "bob", "bobby", "robbie" },
        new[] { "richard", "rick", "ricky", "rich" },
        new[] { "edward", "ed", "eddie" },
        new[] { "james", "jim", "jimmy", "jamie" },
        new[] { "steven", "stephen", "steve", "stevie" },
        new[] { "patrick", "pat" },
        new[] { "jeffrey", "jeff" },
        new[] { "gregory", "greg" },
        new[] { "vincent", "vince", "vinny", "vinnie" },
        new[] { "frederick", "frederic", "fred", "freddy" },
        new[] { "mitchell", "mitch" },
        new[] { "nathan", "nate", "nathaniel" },
        new[] { "dmitri", "dmitry", "dmitriy" },
        new[] { "sergei", "sergey" },
        new[] { "evgeni", "evgeny", "yevgeni" },
        new[] { "vladislav", "vlad" },
        new[] { "vasily", "vasiliy", "vasili" },
        new[] { "nikolai", "nikolay" },
        new[] { "ilya", "ilia" },
        new[] { "yegor", "egor" },
        new[] { "fedor", "fyodor" },
        new[] { "arseni", "arsenii", "arseny" },
        new[] { "phillip", "philip", "phil" },
        new[] { "yaroslav", "jaroslav" }
    };

            var map = new Dictionary<string, int>();

            for (var g = 0; g < groups.Length; g++)
            {
                foreach (var name in groups[g])
                    map[name] = g;
            }

            return map;
        }

        private static bool AreNicknames(string a, string b)
        {
            return NicknameGroupIds.TryGetValue(a, out var ga) &&
                   NicknameGroupIds.TryGetValue(b, out var gb) &&
                   ga == gb;
        }

        private static double JaroWinkler(string s1, string s2)
        {
            if (s1 == s2) return 1.0;
            if (s1.Length == 0 || s2.Length == 0) return 0.0;

            var matchDistance = Math.Max(0, Math.Max(s1.Length, s2.Length) / 2 - 1);

            var s1Matches = new bool[s1.Length];
            var s2Matches = new bool[s2.Length];
            var matches = 0;

            for (var i = 0; i < s1.Length; i++)
            {
                var start = Math.Max(0, i - matchDistance);
                var end = Math.Min(i + matchDistance + 1, s2.Length);

                for (var j = start; j < end; j++)
                {
                    if (s2Matches[j] || s1[i] != s2[j]) continue;

                    s1Matches[i] = true;
                    s2Matches[j] = true;
                    matches++;
                    break;
                }
            }

            if (matches == 0) return 0.0;

            var k = 0;
            var transpositions = 0;

            for (var i = 0; i < s1.Length; i++)
            {
                if (!s1Matches[i]) continue;

                while (!s2Matches[k]) k++;

                if (s1[i] != s2[k]) transpositions++;
                k++;
            }

            double m = matches;
            var jaro = (m / s1.Length + m / s2.Length + (m - transpositions / 2.0) / m) / 3.0;

            var prefix = 0;
            for (var i = 0; i < Math.Min(4, Math.Min(s1.Length, s2.Length)); i++)
            {
                if (s1[i] == s2[i]) prefix++;
                else break;
            }

            return jaro + prefix * 0.1 * (1.0 - jaro);
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
    public class CapFreezeMatchResult
    {
        public CapFreezePlayerLink Entry { get; set; } = null!;
        public Player? Player { get; set; }
        public string MatchType { get; set; } = "Unmatched";

        // Best uncertain candidate. It is NOT applied, only stored for review.
        public Player? ReviewCandidate { get; set; }
        public double ReviewFirstSimilarity { get; set; }
        public double ReviewLastSimilarity { get; set; }
        public double ReviewFullSimilarity { get; set; }
    }
}
