using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.NHL;
using NhlFantasyLeague.api.Services.Health;
using System.Globalization;
using System.Net.Http;
using System.Text;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlInjuryService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;
        private readonly ILogger<NhlInjuryService> _logger;
        private readonly ExternalSourceHealthService _health;

        private const string EspnInjuriesUrl =
            "https://site.api.espn.com/apis/site/v2/sports/hockey/nhl/injuries";

        private const double AutoAcceptLast = 0.97;
        private const double AutoAcceptFirst = 0.92;
        private const double MinLeadOverRunnerUp = 0.05;

        /// <summary>
        /// Any league-wide injuries payload with this many injured
        /// players or fewer is treated as suspicious and refused.
        /// ESPN occasionally returns a 200 with a truncated feed, and
        /// without this guard we would silently wipe every injury flag.
        /// </summary>
        private const int MinimumPlausibleInjuries = 5;

        public NhlInjuryService(
            HttpClient httpClient,
            AppDbContext dbContext,
            ILogger<NhlInjuryService> logger,
            ExternalSourceHealthService health)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _logger = logger;
            _health = health;
        }

        public async Task<NhlInjurySyncResult> RefreshAsync(
            CancellationToken ct = default)
        {
            var now = DateTime.UtcNow;

            // --- Fetch ----------------------------------------------------
            NhlInjuryResponse? payload;

            try
            {
                payload = await _httpClient.GetFromJsonAsync<NhlInjuryResponse>(
                    EspnInjuriesUrl, ct);
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    "ESPN injuries fetch failed: {Type}: {Message}",
                    ex.GetType().Name, ex.Message);

                await _health.RecordFailureAsync(
                    ExternalSourceHealthService.EspnInjuries,
                    $"{ex.GetType().Name}: {ex.Message}",
                    ct);

                return new NhlInjurySyncResult
                {
                    Success = false,
                    Message = "ESPN fetch failed. Existing injury data was left untouched."
                };
            }

            if (payload == null || payload.Teams.Count == 0)
            {
                _logger.LogWarning("ESPN injuries payload was empty.");

                await _health.RecordFailureAsync(
                    ExternalSourceHealthService.EspnInjuries,
                    "ESPN injuries payload was empty.",
                    ct);

                return new NhlInjurySyncResult
                {
                    Success = false,
                    Message = "ESPN returned no injuries. Existing data left untouched."
                };
            }

            // Guard against a truncated payload: fewer than a handful of
            // injured players league-wide is almost certainly ESPN
            // misbehaving, not a healthy October league.
            var totalInjuredPlayers = payload.Teams
                .Sum(t => t.Players.Count);

            if (totalInjuredPlayers <= MinimumPlausibleInjuries)
            {
                _logger.LogWarning(
                    "ESPN injuries payload looks suspicious: only {Count} " +
                    "injured players league-wide. Treating as a failed fetch.",
                    totalInjuredPlayers);

                await _health.RecordFailureAsync(
                    ExternalSourceHealthService.EspnInjuries,
                    $"Suspicious payload: only {totalInjuredPlayers} " +
                    "injured players league-wide.",
                    ct);

                return new NhlInjurySyncResult
                {
                    Success = false,
                    Message =
                        $"ESPN returned only {totalInjuredPlayers} injured " +
                        "players. Refusing to update. Existing data left untouched."
                };
            }

            // Second guard: compare against the DB's current injured
            // count. A sudden drop of more than 40% is almost always a
            // truncated payload — ESPN reporting the wrong day, partial
            // outage, etc. Refuse and let the next cycle retry.
            var existingInjuredCount = await _dbContext.Players
                .AsNoTracking()
                .CountAsync(p => p.IsInjured, ct);

            if (existingInjuredCount >= 10)
            {
                var ratio =
                    (double)totalInjuredPlayers / existingInjuredCount;

                if (ratio < 0.60)
                {
                    _logger.LogWarning(
                        "ESPN injuries payload dropped from {Existing} to " +
                        "{New} players ({Ratio:P0}). Treating as a partial " +
                        "fetch and refusing to update.",
                        existingInjuredCount, totalInjuredPlayers, ratio);

                    await _health.RecordFailureAsync(
                        ExternalSourceHealthService.EspnInjuries,
                        $"Partial payload: {existingInjuredCount} -> " +
                        $"{totalInjuredPlayers} injured players.",
                        ct);

                    return new NhlInjurySyncResult
                    {
                        Success = false,
                        Message =
                            $"ESPN injuries count dropped from " +
                            $"{existingInjuredCount} to {totalInjuredPlayers}. " +
                            "Refusing to update. Existing data left untouched."
                    };
                }
            }

            // --- Team lookup (ONE query for the whole refresh) -------------
            //
            // The old code re-queried NhlTeams inside ResolveTeamIdAsync
            // every time an ESPN team could not be resolved by its id.
            // Now we load everything we need once, and build both the
            // abbreviation and the normalized-name lookups from that
            // single result set.
            var teamRows = await _dbContext.NhlTeams
                .AsNoTracking()
                .Where(t =>
                    t.Abbreviation != null &&
                    t.Abbreviation != "")
                .Select(t => new
                {
                    t.Abbreviation,
                    t.Name,
                    t.NhlTeamId
                })
                .ToListAsync(ct);

            var teamByAbbrev = teamRows
                .GroupBy(t => t.Abbreviation.ToLowerInvariant())
                .ToDictionary(
                    g => g.Key,
                    g => g.First().NhlTeamId);

            var teamByName = teamRows
                .Where(t => !string.IsNullOrWhiteSpace(t.Name))
                .GroupBy(t => NormalizeTeamName(t.Name))
                .ToDictionary(
                    g => g.Key,
                    g => g.First().NhlTeamId);

            // --- Load every player once, indexed by NHL team --------------
            //
            // NOTE: this load MUST stay tracked. RefreshAsync clears and
            // rewrites injury fields on every Player row below, then
            // calls SaveChangesAsync. If we add AsNoTracking here, the
            // writes silently do nothing.
            var allPlayers = await _dbContext.Players
                .Include(p => p.NhlTeam)
                .Where(p =>
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync(ct);

            var playersByTeam = allPlayers
                .Where(p => p.NhlTeamId != null)
                .GroupBy(p => p.NhlTeamId!.Value)
                .ToDictionary(g => g.Key, g => g.ToList());

            var playersByPrevTeam = allPlayers
                .Where(p => p.PreviousNhlTeamId != null)
                .GroupBy(p => p.PreviousNhlTeamId!.Value)
                .ToDictionary(g => g.Key, g => g.ToList());

            // --- Clear current injury fields ------------------------------
            var previouslyInjured = allPlayers
                .Where(p => p.IsInjured)
                .ToList();

            foreach (var p in allPlayers)
            {
                p.IsInjured = false;
                p.InjuryStatus = null;
                p.InjuryKind = InjuryKind.None;
                p.InjuryShortDescription = null;
                p.InjuryLongDescription = null;
                p.InjuryType = null;
                p.InjuryDetail = null;
                p.InjurySide = null;
                p.InjuryReturnDate = null;
                p.InjuryFantasyStatus = null;
                p.InjuryUpdatedAt = now;
            }

            // --- Match + apply --------------------------------------------
            var matched = 0;
            var unmatched = 0;
            var unmatchedNames = new List<string>();

            foreach (var team in payload.Teams)
            {
                var teamId = ResolveTeamId(
                    team, teamByAbbrev, teamByName);

                if (teamId == null)
                {
                    _logger.LogWarning(
                        "ESPN team '{Name}' could not be mapped to an NHL team.",
                        team.DisplayName);

                    unmatched += team.Players.Count;

                    foreach (var p in team.Players)
                    {
                        var n = p.Athlete?.DisplayName ?? "(unknown)";
                        unmatchedNames.Add(
                            $"{n} — team '{team.DisplayName}' not mapped");
                    }

                    continue;
                }

                var candidates = new List<Player>();

                if (playersByTeam.TryGetValue(teamId.Value, out var current))
                    candidates.AddRange(current);

                if (playersByPrevTeam.TryGetValue(teamId.Value, out var previous))
                    candidates.AddRange(previous);

                if (candidates.Count == 0)
                {
                    unmatched += team.Players.Count;

                    foreach (var p in team.Players)
                    {
                        var n = p.Athlete?.DisplayName ?? "(unknown)";
                        unmatchedNames.Add(
                            $"{n} — no candidates on {team.DisplayName}");
                    }

                    continue;
                }

                foreach (var row in team.Players)
                {
                    var name = row.Athlete?.DisplayName;

                    if (string.IsNullOrWhiteSpace(name))
                    {
                        unmatched++;
                        continue;
                    }

                    var match = MatchPlayer(name, row.Athlete?.Position?.Abbreviation, candidates);

                    if (match == null)
                    {
                        _logger.LogInformation(
                            "ESPN injury row '{Name}' ({Team}) did not match any player.",
                            name, team.DisplayName);

                        unmatchedNames.Add(
                            $"{name} ({row.Athlete?.Position?.Abbreviation}) — {team.DisplayName}");
                        unmatched++;
                        continue;
                    }

                    await ApplyInjuryAsync(match, row, now);
                    matched++;
                }
            }

            // --- Resolve history spells that ended -------------------------
            //
            // NOTE: this load must stay tracked. We set ResolvedAt or
            // LastSeenAt on the rows below.
            var openSpells = await _dbContext.PlayerInjuryHistories
                .Where(h => h.ResolvedAt == null)
                .ToListAsync(ct);

            var playerById = allPlayers.ToDictionary(p => p.Id);

            foreach (var spell in openSpells)
            {
                if (!playerById.TryGetValue(spell.PlayerId, out var player))
                {
                    spell.ResolvedAt = now;
                    continue;
                }

                var stillSameSpell =
                    player.IsInjured &&
                    string.Equals(
                        player.InjuryStatus?.Trim(),
                        spell.InjuryStatus.Trim(),
                        StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(
                        GetTeamAbbreviation(player),
                        spell.TeamAbbreviation,
                        StringComparison.OrdinalIgnoreCase);

                if (!stillSameSpell)
                {
                    spell.ResolvedAt = now;
                }
                else
                {
                    spell.LastSeenAt = now;
                }
            }

            // --- Defensive: collapse duplicate open spells -----------
            // If the same (player, status, team) triple somehow has
            // more than one open spell, keep the one with the newest
            // LastSeenAt and resolve the rest. This protects the
            // "Historique des blessures" section on PlayerPage from
            // ever showing the same injury multiple times.
            var remainingOpen = openSpells
                .Where(h => h.ResolvedAt == null)
                .ToList();

            var duplicateGroups = remainingOpen
                .GroupBy(h => new
                {
                    h.PlayerId,
                    Status = h.InjuryStatus.Trim().ToLowerInvariant(),
                    Team = h.TeamAbbreviation.Trim().ToLowerInvariant(),
                })
                .Where(g => g.Count() > 1)
                .ToList();

            foreach (var group in duplicateGroups)
            {
                var ordered = group
                    .OrderByDescending(h => h.LastSeenAt)
                    .ToList();

                for (var i = 1; i < ordered.Count; i++)
                {
                    ordered[i].ResolvedAt = now;
                }

                _logger.LogInformation(
                    "Collapsed {Count} duplicate open injury spell(s) " +
                    "for player {PlayerId} ({Status} / {Team}).",
                    ordered.Count - 1,
                    group.Key.PlayerId,
                    group.Key.Status,
                    group.Key.Team);
            }


            await _dbContext.SaveChangesAsync(ct);

            await _health.RecordSuccessAsync(
                ExternalSourceHealthService.EspnInjuries,
                ct);

            return new NhlInjurySyncResult
            {
                Success = true,
                Message = $"Injuries refreshed: {matched} matched, {unmatched} unmatched.",
                MatchedCount = matched,
                UnmatchedCount = unmatched,
                PreviouslyInjuredCount = previouslyInjured.Count,
                UnmatchedNames = unmatchedNames
            };
        }

        // =================================================================
        // Matching
        // =================================================================

        private static Player? MatchPlayer(
            string espnName,
            string? espnPosition,
            List<Player> candidates)
        {
            var entryInfo = BuildEntryNameInfo(espnName);

            var scored = new List<(Player Player, double First, double Last, double Score)>();

            foreach (var candidate in candidates)
            {
                if (!PositionsCompatible(espnPosition, candidate.Position))
                    continue;

                var playerInfo = BuildPlayerNameInfo(candidate);
                var (first, last) = ScoreNames(entryInfo, playerInfo);

                if (last < 0.90 || first < 0.85)
                    continue;

                var score = 0.6 * last + 0.4 * first;
                scored.Add((candidate, first, last, score));
            }

            if (scored.Count == 0)
                return null;

            var ordered = scored.OrderByDescending(s => s.Score).ToList();
            var best = ordered[0];

            var runnerUp = ordered
                .Skip(1)
                .Select(s => s.Score)
                .DefaultIfEmpty(0)
                .Max();

            var strong = best.Last >= AutoAcceptLast && best.First >= AutoAcceptFirst;
            var clearLead = best.Score - runnerUp >= MinLeadOverRunnerUp;

            return strong && clearLead ? best.Player : null;
        }

        private async Task ApplyInjuryAsync(Player player, NhlInjuryPlayer row, DateTime now)
        {
            player.IsInjured = true;
            player.InjuryStatus = row.Status;
            player.InjuryKind = ClassifyKind(row.Status);
            player.InjuryShortDescription = row.ShortComment;
            player.InjuryLongDescription = row.LongComment;
            player.InjuryUpdatedAt = now;
            player.InjuryType = row.Details?.Type;
            player.InjuryDetail = row.Details?.Detail;
            player.InjurySide = row.Details?.Side;
            player.InjuryReturnDate = row.Details?.ReturnDate;
            player.InjuryFantasyStatus = row.Details?.FantasyStatus?.Description;

            // History upsert: find the open spell for (player, status, team),
            // update LastSeenAt, or open a new one.
            var teamAbbrev = GetTeamAbbreviation(player);
            var status = (row.Status ?? string.Empty).Trim();

            // Look in the local (tracked) set first, then in the database.
            // Both lookups are trimmed and case-insensitive so cosmetic
            // ESPN changes never open a brand new spell.
            // 1. Try the local (tracked) set first. This catches rows that
            //    were opened earlier in this same refresh cycle.
            var open = _dbContext.PlayerInjuryHistories.Local
                .FirstOrDefault(h =>
                    h.PlayerId == player.Id &&
                    h.ResolvedAt == null &&
                    string.Equals(
                        h.InjuryStatus.Trim(),
                        status,
                        StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(
                        h.TeamAbbreviation,
                        teamAbbrev,
                        StringComparison.OrdinalIgnoreCase));

            // 2. Fall back to the database. Load the player's open spells
            //    once and compare in memory: EF Core cannot translate the
            //    StringComparison overload.
            //
            //    NOTE: must stay tracked, because we set LastSeenAt on a
            //    match below.
            if (open == null)
            {
                var openSpellsForPlayer = await _dbContext.PlayerInjuryHistories
                    .Where(h =>
                        h.PlayerId == player.Id &&
                        h.ResolvedAt == null)
                    .ToListAsync();

                open = openSpellsForPlayer.FirstOrDefault(h =>
                    string.Equals(
                        h.InjuryStatus.Trim(),
                        status,
                        StringComparison.OrdinalIgnoreCase) &&
                    string.Equals(
                        h.TeamAbbreviation,
                        teamAbbrev,
                        StringComparison.OrdinalIgnoreCase));
            }

            if (open != null)
            {
                open.LastSeenAt = now;
                return;
            }

            _dbContext.PlayerInjuryHistories.Add(new PlayerInjuryHistory
            {
                PlayerId = player.Id,
                InjuryStatus = status,
                InjuryDescription = row.ShortComment ?? row.LongComment,
                TeamAbbreviation = teamAbbrev,
                FirstSeenAt = now,
                LastSeenAt = now,
                ResolvedAt = null
            });
        }

        /// <summary>
        /// Returns the NHL team abbreviation for the player, reading it
        /// from the loaded navigation property first, and falling back to
        /// a database lookup. Returns an empty string when the player has
        /// no NHL team (free agent, unsigned, ...).
        /// </summary>
        private string GetTeamAbbreviation(Player player)
        {
            if (!string.IsNullOrWhiteSpace(player.NhlTeam?.Abbreviation))
            {
                return player.NhlTeam!.Abbreviation;
            }

            if (player.NhlTeamId == null)
            {
                return string.Empty;
            }

            return _dbContext.NhlTeams
                .AsNoTracking()
                .Where(t => t.NhlTeamId == player.NhlTeamId)
                .Select(t => t.Abbreviation)
                .FirstOrDefault()
                ?? string.Empty;
        }

        /// <summary>
        /// Maps an ESPN status string to a normalized InjuryKind.
        ///
        /// "Suspension" / "Suspended" -> Suspension.
        /// Anything else non-empty -> Injury.
        /// Empty or null -> None.
        /// </summary>
        private static InjuryKind ClassifyKind(string? status)
        {
            if (string.IsNullOrWhiteSpace(status))
                return InjuryKind.None;

            var s = status.Trim().ToLowerInvariant();

            if (s.Contains("suspend"))
                return InjuryKind.Suspension;

            return InjuryKind.Injury;
        }

        /// <summary>
        /// Resolves an ESPN team to our NhlTeamId using only pre-built
        /// lookups. No database calls: the caller loaded every team once
        /// at the top of RefreshAsync.
        ///
        /// 1. ESPN team id equals our abbreviation (most common case).
        /// 2. Normalized name match.
        /// 3. Last resort: one normalized name contains the other.
        /// </summary>
        private static int? ResolveTeamId(
            NhlInjuryTeam team,
            Dictionary<string, int> teamByAbbrev,
            Dictionary<string, int> teamByName)
        {
            // 1. ESPN team id equals our abbreviation? Most common case.
            if (!string.IsNullOrWhiteSpace(team.Id) &&
                teamByAbbrev.TryGetValue(
                    team.Id.Trim().ToLowerInvariant(),
                    out var byId))
            {
                return byId;
            }

            if (string.IsNullOrWhiteSpace(team.DisplayName))
                return null;

            // 2. Match by name, ignoring accents and punctuation.
            var espnName = NormalizeTeamName(team.DisplayName);

            if (teamByName.TryGetValue(espnName, out var byName))
            {
                return byName;
            }

            // 3. Last resort: one normalized name contains the other.
            foreach (var kvp in teamByName)
            {
                if (kvp.Key.Contains(espnName) || espnName.Contains(kvp.Key))
                {
                    return kvp.Value;
                }
            }

            return null;
        }

        /// <summary>
        /// Strips accents, lowercases, and removes punctuation so
        /// "Montréal Canadiens" and "Montreal Canadiens" compare equal.
        /// </summary>
        private static string NormalizeTeamName(string text)
        {
            var normalized = RemoveDiacritics(text)
                .ToLowerInvariant()
                .Replace(".", "")
                .Replace("-", "")
                .Replace("'", "")
                .Replace(" ", "");

            return normalized;
        }

        // =================================================================
        // Name matching helpers (adapted from CapFreezeMatchingService)
        // =================================================================

        private sealed class PlayerNameInfo
        {
            public string Last { get; set; } = "";
            public HashSet<string> FirstVariants { get; set; } = new();
        }

        private sealed class EntryNameInfo
        {
            public List<(HashSet<string> FirstVariants, string Last)> Splits { get; } = new();
        }

        private static (double First, double Last) ScoreNames(
            EntryNameInfo entry,
            PlayerNameInfo player)
        {
            double bestFirst = 0;
            double bestLast = 0;
            double bestCombined = -1;

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
            HashSet<string> a,
            HashSet<string> b)
        {
            double best = 0;

            foreach (var x in a)
            {
                foreach (var y in b)
                {
                    if (x == y)
                        return 1.0;

                    if (AreNicknames(x, y))
                        best = Math.Max(best, 0.95);
                    else if (x.Length >= 3 && y.Length >= 3 &&
                             (x.StartsWith(y) || y.StartsWith(x)))
                        best = Math.Max(best, 0.92);
                    else
                        best = Math.Max(best, JaroWinkler(x, y));
                }
            }

            return best;
        }

        private static EntryNameInfo BuildEntryNameInfo(string name)
        {
            var tokens = Tokenize(name);
            var info = new EntryNameInfo();

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
            return new PlayerNameInfo
            {
                Last = string.Concat(Tokenize(player.LastName)),
                FirstVariants = FirstNameVariants(player.FirstName)
            };
        }

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
                .Split(new[] { ' ', '-', '(', ')', ',', '\t' },
                    StringSplitOptions.RemoveEmptyEntries)
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
                if (CharUnicodeInfo.GetUnicodeCategory(c) !=
                    UnicodeCategory.NonSpacingMark)
                {
                    sb.Append(c);
                }
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

        /// <summary>
        /// Position gate for name matching.
        ///
        /// We only reject a pair when one side is a goalie and the other is
        /// not: goalies are easy to misidentify and their injuries do not
        /// overlap with skater rows. Any other disagreement (C vs D, LW vs
        /// RW, ...) is allowed, because ESPN and the NHL regularly classify
        /// the same player differently.
        /// </summary>
        private static bool PositionsCompatible(string? a, string? b)
        {
            var ga = PositionGroup(a);
            var gb = PositionGroup(b);

            if (ga.Length == 0 || gb.Length == 0)
                return true;

            if (ga == gb)
                return true;

            // The only hard exclusion: G vs non-G.
            var oneIsGoalie = ga == "G" || gb == "G";

            return !oneIsGoalie;
        }

        private static readonly Dictionary<string, int> NicknameGroupIds =
            BuildNicknameMap();

        private static Dictionary<string, int> BuildNicknameMap()
        {
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
            var jaro = (m / s1.Length + m / s2.Length +
                        (m - transpositions / 2.0) / m) / 3.0;

            var prefix = 0;
            for (var i = 0; i < Math.Min(4, Math.Min(s1.Length, s2.Length)); i++)
            {
                if (s1[i] == s2[i]) prefix++;
                else break;
            }

            return jaro + prefix * 0.1 * (1.0 - jaro);
        }
    }

    public class NhlInjurySyncResult
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public int MatchedCount { get; set; }
        public int UnmatchedCount { get; set; }
        public int PreviouslyInjuredCount { get; set; }
        public List<string> UnmatchedNames { get; set; } = new();
    }
}