using System.Net.Http;
using System.Text.Json;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services.Health;

namespace NhlFantasyLeague.api.Services.Health
{
    /// <summary>
    /// Computes each player's current RosterLocation (NhlRoster,
    /// AhlRoster, Injured, NotOnActiveRoster) by combining three
    /// sources:
    ///
    ///   - NHL rosters        (api-web.nhle.com, per team)
    ///   - AHL rosters        (HockeyTech feed, per AHL affiliate)
    ///   - Player.IsInjured   (already set by NhlInjuryService from ESPN)
    ///
    /// The service never writes injury fields itself. It reads the
    /// injury state as an input, then applies the league's nuanced
    /// clearing rule:
    ///
    ///   Not on either + currently injured       -> keep injury, Injured
    ///   Not on either + not injured             -> NotOnActiveRoster
    ///
    /// Additionally, if the ESPN feed has not produced a successful
    /// fetch in over 48 hours, every injury flag is cleared first and
    /// the ladder collapses to NhlRoster / AhlRoster / NotOnActiveRoster.
    ///
    /// The entire service is a no-op when PlayerStatus:Enabled is false
    /// in appsettings. That lets us build the pipeline now and switch
    /// it on later once the scheduled jobs exist.
    /// </summary>
    public class PlayerRosterStatusService
    {
        private readonly AppDbContext _dbContext;
        private readonly HttpClient _httpClient;
        private readonly ExternalSourceHealthService _health;
        private readonly IConfiguration _configuration;
        private readonly ILogger<PlayerRosterStatusService> _logger;

        /// <summary>How long the injury data stays trusted.</summary>
        private static readonly TimeSpan DegradedThreshold = TimeSpan.FromHours(24);

        /// <summary>How long before the injury data is cleared entirely.</summary>
        private static readonly TimeSpan BrokenThreshold = TimeSpan.FromHours(48);

        /// <summary>
        /// HockeyTech season ID for the current AHL regular season.
        /// The AHL feed requires an explicit season; without it the
        /// roster returns section headers but zero players.
        ///
        /// 2026-27 Regular Season = 94.
        /// This needs to be bumped each October when the new season
        /// starts. The full season list is published at:
        /// https://fastrhockey.sportsdataverse.org/reference/ahl_season_id.html
        /// </summary>
        private const int AhlCurrentSeasonId = 94;

        public PlayerRosterStatusService(
            AppDbContext dbContext,
            HttpClient httpClient,
            ExternalSourceHealthService health,
            IConfiguration configuration,
            ILogger<PlayerRosterStatusService> logger)
        {
            _dbContext = dbContext;
            _httpClient = httpClient;
            _health = health;
            _configuration = configuration;
            _logger = logger;
        }

        /// <summary>
        /// Runs the full status refresh. Returns a small report suitable
        /// for a manual endpoint. No-op when the feature is disabled.
        /// </summary>
        public async Task<PlayerRosterStatusResult> RefreshAsync(
            CancellationToken ct = default)
        {
            var result = new PlayerRosterStatusResult
            {
                Enabled = IsEnabled()
            };

            if (!result.Enabled)
            {
                result.Message =
                    "PlayerStatus feature is disabled in configuration. " +
                    "Set PlayerStatus:Enabled = true to run this.";

                return result;
            }

            var now = DateTime.UtcNow;

            // ---------------------------------------------------------
            // ESPN health check (for the escalation ladder).
            //
            // NhlInjuryService owns the writes to Player injury fields;
            // here we just look at how long it has been since a
            // successful fetch.
            // ---------------------------------------------------------

            var espnHealth = await _health.GetAsync(
                ExternalSourceHealthService.EspnInjuries, ct);

            var hoursSinceEspnSuccess =
                espnHealth?.LastSuccessAt is DateTime lastSuccess
                    ? (now - lastSuccess).TotalHours
                    : double.PositiveInfinity;

            result.HoursSinceEspnSuccess =
                double.IsPositiveInfinity(hoursSinceEspnSuccess)
                    ? null
                    : Math.Round(hoursSinceEspnSuccess, 2);

            var injuryDataIsStale =
                hoursSinceEspnSuccess > BrokenThreshold.TotalHours;

            var injuryDataIsDegraded =
                !injuryDataIsStale &&
                hoursSinceEspnSuccess > DegradedThreshold.TotalHours;

            result.InjuryDataIsStale = injuryDataIsStale;
            result.InjuryDataIsDegraded = injuryDataIsDegraded;

            if (injuryDataIsStale)
            {
                _logger.LogWarning(
                    "ESPN injury feed has been silent for over {Hours} " +
                    "hours. Clearing every Player.IsInjured flag before " +
                    "recomputing RosterLocation.",
                    BrokenThreshold.TotalHours);
            }

            // ---------------------------------------------------------
            // Fetch NHL rosters.
            // ---------------------------------------------------------

            HashSet<int> nhlRosterPlayerIds;

            try
            {
                var (ids, perTeam) = await FetchNhlRosterPlayerIdsAsync(ct);

                nhlRosterPlayerIds = ids;

                await _health.RecordSuccessAsync(
                    ExternalSourceHealthService.NhlRosters, ct);

                result.NhlPlayersFound = nhlRosterPlayerIds.Count;
                result.NhlPlayersPerTeam = perTeam;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "NHL roster fetch failed. Players will not be marked " +
                    "as NhlRoster this cycle.");

                await _health.RecordFailureAsync(
                    ExternalSourceHealthService.NhlRosters,
                    $"{ex.GetType().Name}: {ex.Message}",
                    ct);

                nhlRosterPlayerIds = new HashSet<int>();
            }

            // ---------------------------------------------------------
            // Fetch AHL rosters.
            //
            // This is best-effort: if the HockeyTech feed changes shape
            // or is unavailable, we log it and move on. The NHL and
            // ESPN parts of the pipeline still work.
            // ---------------------------------------------------------

            HashSet<string> ahlRosterNormalizedNames;

            try
            {
                ahlRosterNormalizedNames =
                    await FetchAhlRosterNormalizedNamesAsync(ct);

                await _health.RecordSuccessAsync(
                    ExternalSourceHealthService.AhlRosters, ct);

                result.AhlPlayersFound = ahlRosterNormalizedNames.Count;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(ex,
                    "AHL roster fetch failed. No player will be marked " +
                    "as AhlRoster this cycle.");

                await _health.RecordFailureAsync(
                    ExternalSourceHealthService.AhlRosters,
                    $"{ex.GetType().Name}: {ex.Message}",
                    ct);

                ahlRosterNormalizedNames = new HashSet<string>();
            }

            // ---------------------------------------------------------
            // Load every player we might need to touch. Tracked because
            // we set RosterLocation and potentially clear injury flags.
            // ---------------------------------------------------------

            var players = await _dbContext.Players
                .Where(p =>
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync(ct);

            result.TotalPlayers = players.Count;

            // ---------------------------------------------------------
            // Apply the escalation ladder to every player before we
            // recompute RosterLocation.
            // ---------------------------------------------------------

            if (injuryDataIsStale)
            {
                foreach (var player in players)
                {
                    ClearInjuryFields(player, now);
                }
            }

            // ---------------------------------------------------------
            // Compute RosterLocation for each player.
            // ---------------------------------------------------------

            var updatedAt = DateTime.UtcNow;

            foreach (var player in players)
            {
                var onNhlRoster =
                    player.NhlPlayerId > 0 &&
                    nhlRosterPlayerIds.Contains(player.NhlPlayerId);

                var normalizedName = NormalizeName(
                    player.FirstName, player.LastName);

                var onAhlRoster =
                    ahlRosterNormalizedNames.Contains(normalizedName);

                // Injury wins over roster location. ESPN is the sole
                // source of truth for the injury flag; this service
                // never writes injury fields. A player who is injured
                // shows as Injured even if he is technically still on
                // the NHL roster, which is the common case for
                // short-term injuries.
                RosterLocation location;

                if (player.IsInjured && !injuryDataIsStale)
                {
                    location = RosterLocation.Injured;
                }
                else if (onNhlRoster)
                {
                    location = RosterLocation.NhlRoster;
                }
                else if (onAhlRoster)
                {
                    location = RosterLocation.AhlRoster;
                }
                else
                {
                    location = RosterLocation.NotOnActiveRoster;
                }

                player.RosterLocation = location;
                player.RosterLocationUpdatedAt = updatedAt;

                switch (location)
                {
                    case RosterLocation.NhlRoster:
                        result.NhlRosterCount++;
                        break;
                    case RosterLocation.AhlRoster:
                        result.AhlRosterCount++;
                        break;
                    case RosterLocation.Injured:
                        result.InjuredCount++;
                        break;
                    case RosterLocation.NotOnActiveRoster:
                        result.NotOnActiveRosterCount++;
                        break;
                }
            }

            await _dbContext.SaveChangesAsync(ct);

            result.Message =
                $"RosterLocation refreshed for {players.Count} players.";

            return result;
        }

        private bool IsEnabled()
        {
            return _configuration.GetValue<bool>(
                "PlayerStatus:Enabled");
        }

        // =================================================================
        // NHL rosters
        // =================================================================

        private async Task<(HashSet<int> Ids, Dictionary<string, int> PerTeam)>
          FetchNhlRosterPlayerIdsAsync(CancellationToken ct)
        {
            var teams = await _dbContext.NhlTeams
                .AsNoTracking()
                .Select(t => t.Abbreviation)
                .ToListAsync(ct);

            var ids = new HashSet<int>();
            var perTeam = new Dictionary<string, int>(
                StringComparer.OrdinalIgnoreCase);

            foreach (var abbreviation in teams)
            {
                if (string.IsNullOrWhiteSpace(abbreviation))
                {
                    continue;
                }

                var url =
                    $"https://api-web.nhle.com/v1/roster/{abbreviation}/current";

                try
                {
                    // The NHL API rate-limits aggressive callers. Retry
                    // on any failure with a short backoff before giving
                    // up on this team. This mirrors the pattern already
                    // used in NhlTeamService.GetRosterAsync.
                    HttpResponseMessage? response = null;
                    const int maxAttempts = 3;

                    for (var attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        response = await _httpClient.GetAsync(url, ct);

                        if (response.IsSuccessStatusCode)
                        {
                            break;
                        }

                        _logger.LogWarning(
                            "NHL roster for {Abbreviation} returned {Status} " +
                            "(attempt {Attempt}/{Max}).",
                            abbreviation, (int)response.StatusCode,
                            attempt, maxAttempts);

                        response.Dispose();
                        response = null;

                        if (attempt < maxAttempts)
                        {
                            // Short backoff: the base loop already
                            // spaces requests by 1.5s, so we only need
                            // a small extra wait between attempts.
                            await Task.Delay(500, ct);
                        }
                    }

                    if (response == null || !response.IsSuccessStatusCode)
                    {
                        // -1 = HTTP error after all retries.
                        perTeam[abbreviation] = -1;
                        continue;
                    }

                    using (response)
                    {
                        using var stream = await response.Content
                            .ReadAsStreamAsync(ct);

                        using var document =
                            await JsonDocument.ParseAsync(
                                stream, cancellationToken: ct);

                        if (!document.RootElement.TryGetProperty(
                                "forwards", out var forwards) ||
                            !document.RootElement.TryGetProperty(
                                "defensemen", out var defensemen) ||
                            !document.RootElement.TryGetProperty(
                                "goalies", out var goalies))
                        {
                            // -2 = shape mismatch.
                            perTeam[abbreviation] = -2;
                            continue;
                        }

                        var before = ids.Count;

                        CollectPlayerIds(forwards, ids);
                        CollectPlayerIds(defensemen, ids);
                        CollectPlayerIds(goalies, ids);

                        perTeam[abbreviation] = ids.Count - before;
                    }

                    await Task.Delay(1200, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "NHL roster fetch for {Abbreviation} failed.",
                        abbreviation);

                    // -3 = exception.
                    perTeam[abbreviation] = -3;
                }
            }

            return (ids, perTeam);
        }

        private static void CollectPlayerIds(
            JsonElement array,
            HashSet<int> target)
        {
            if (array.ValueKind != JsonValueKind.Array)
            {
                return;
            }

            foreach (var element in array.EnumerateArray())
            {
                if (element.TryGetProperty("id", out var idElement) &&
                    idElement.ValueKind == JsonValueKind.Number)
                {
                    target.Add(idElement.GetInt32());
                }
            }
        }

        // =================================================================
        // AHL rosters
        // =================================================================

        private async Task<HashSet<string>> FetchAhlRosterNormalizedNamesAsync(
      CancellationToken ct)
        {
            var names = new HashSet<string>();

            // Fetch every AHL team for the current season, then load
            // every roster. We do NOT go through an NHL -> AHL
            // affiliation map: in the AHL, one affiliate can carry
            // players whose NHL rights belong to different clubs, so
            // the roster itself is the source of truth.
            var teamIdsByName = await FetchAhlTeamIdsAsync(ct);

            _logger.LogInformation(
                "Fetched {Count} AHL team ids for season {Season}.",
                teamIdsByName.Count, AhlCurrentSeasonId);

            foreach (var teamId in teamIdsByName.Values)
            {
                var url =
                    "https://lscluster.hockeytech.com/feed/index.php" +
                    "?feed=modulekit&view=roster" +
                    "&key=ccb91f29d6744675" +
                    "&client_code=ahl" +
                    "&site_id=3" +
                    "&lang=en" +
                    "&callback=angular.callbacks._0" +
                    $"&team_id={teamId}" +
                    $"&season_id={AhlCurrentSeasonId}";

                try
                {
                    using var response = await _httpClient.GetAsync(url, ct);

                    if (!response.IsSuccessStatusCode)
                    {
                        _logger.LogWarning(
                            "AHL roster for team {TeamId} returned {Status}.",
                            teamId, (int)response.StatusCode);

                        continue;
                    }

                    var json = await response.Content.ReadAsStringAsync(ct);

                    if (string.IsNullOrWhiteSpace(json))
                    {
                        continue;
                    }

                    var trimmed = json.Trim();

                    var firstBrace = trimmed.IndexOf('{');
                    var lastBrace = trimmed.LastIndexOf('}');

                    if (firstBrace >= 0 && lastBrace > firstBrace)
                    {
                        trimmed = trimmed.Substring(
                            firstBrace, lastBrace - firstBrace + 1);
                    }

                    using var document = JsonDocument.Parse(trimmed);

                    var rosterEntries = ExtractRosterEntries(document);

                    foreach (var entry in rosterEntries)
                    {
                        if (!entry.TryGetProperty(
                                "name", out var nameElement) ||
                            nameElement.ValueKind != JsonValueKind.String)
                        {
                            continue;
                        }

                        var fullName = nameElement.GetString();

                        if (string.IsNullOrWhiteSpace(fullName))
                        {
                            continue;
                        }

                        var parts = fullName.Split(
                            ' ',
                            StringSplitOptions.RemoveEmptyEntries);

                        if (parts.Length < 2)
                        {
                            continue;
                        }

                        var firstName = parts[0];
                        var lastName = string.Join(" ", parts.Skip(1));

                        var normalized = NormalizeName(
                            firstName, lastName);

                        if (!string.IsNullOrEmpty(normalized))
                        {
                            names.Add(normalized);
                        }
                    }

                    await Task.Delay(1200, ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex,
                        "AHL roster fetch for team {TeamId} failed.",
                        teamId);
                }
            }

            return names;
        }

        /// <summary>
        /// Fetches the current AHL team IDs from the modulekit
        /// teamsbyseason feed. Returns a dictionary keyed by normalized
        /// team name.
        ///
        /// This exists because AHL team IDs change when teams relocate
        /// or the league restructures. The hardcoded dictionary is not
        /// reliable across seasons.
        /// </summary>
        private async Task<Dictionary<string, int>> FetchAhlTeamIdsAsync(
            CancellationToken ct)
        {
            var url =
                "https://lscluster.hockeytech.com/feed/index.php" +
                "?feed=modulekit&view=teamsbyseason" +
                "&key=ccb91f29d6744675" +
                "&client_code=ahl" +
                "&site_id=3" +
                "&lang=en" +
                "&callback=angular.callbacks._0" +
                $"&season_id={AhlCurrentSeasonId}";

            using var response = await _httpClient.GetAsync(url, ct);

            if (!response.IsSuccessStatusCode)
            {
                _logger.LogWarning(
                    "AHL teamsbyseason returned {Status}.",
                    (int)response.StatusCode);

                return new Dictionary<string, int>(
                    StringComparer.OrdinalIgnoreCase);
            }

            var json = await response.Content.ReadAsStringAsync(ct);

            var trimmed = json.Trim();
            var firstBrace = trimmed.IndexOf('{');
            var lastBrace = trimmed.LastIndexOf('}');

            if (firstBrace >= 0 && lastBrace > firstBrace)
            {
                trimmed = trimmed.Substring(
                    firstBrace, lastBrace - firstBrace + 1);
            }

            using var document = JsonDocument.Parse(trimmed);

            var result = new Dictionary<string, int>(
                StringComparer.OrdinalIgnoreCase);

            if (!document.RootElement.TryGetProperty(
                    "SiteKit", out var siteKit))
            {
                return result;
            }

            if (!siteKit.TryGetProperty(
                    "Teamsbyseason", out var teams) ||
                teams.ValueKind != JsonValueKind.Array)
            {
                return result;
            }

            foreach (var team in teams.EnumerateArray())
            {
                if (!team.TryGetProperty("id", out var idElement) ||
                    !team.TryGetProperty("name", out var nameElement))
                {
                    continue;
                }

                var idString = idElement.ValueKind == JsonValueKind.String
                    ? idElement.GetString()
                    : idElement.GetInt32().ToString();

                var name = nameElement.GetString();

                if (string.IsNullOrWhiteSpace(idString) ||
                    string.IsNullOrWhiteSpace(name) ||
                    !int.TryParse(idString, out var teamId))
                {
                    continue;
                }

                var normalizedName = NormalizeName(name, string.Empty);

                result[normalizedName] = teamId;
            }

            return result;
        }

        private static IEnumerable<JsonElement> ExtractRosterEntries(
      JsonDocument document)
        {
            // Real shape of modulekit/roster:
            //   { "SiteKit": { "Roster": [
            //       { player1 }, { player2 }, ..., { playerN },
            //       [ personnel1, personnel2, ... ]
            //   ] } }
            //
            // Player objects are direct elements of the Roster array;
            // the personnel section is a single nested array at the end.
            // Players have a "position" field; personnel have a "role"
            // field. We only yield the player objects.
            if (!document.RootElement.TryGetProperty(
                    "SiteKit", out var siteKit))
            {
                yield break;
            }

            if (!siteKit.TryGetProperty("Roster", out var roster))
            {
                yield break;
            }

            if (roster.ValueKind != JsonValueKind.Array)
            {
                yield break;
            }

            foreach (var element in roster.EnumerateArray())
            {
                // Skip the nested personnel array (and any other non-object).
                if (element.ValueKind != JsonValueKind.Object)
                {
                    continue;
                }

                // Players have a "position" field; personnel have "role".
                if (!element.TryGetProperty("position", out _))
                {
                    continue;
                }

                yield return element;
            }
        }

        // =================================================================
        // Helpers
        // =================================================================

        private static void ClearInjuryFields(Player player, DateTime now)
        {
            if (!player.IsInjured &&
                player.InjuryStatus == null &&
                player.InjuryKind == InjuryKind.None)
            {
                // Nothing to clear. Skip the timestamp churn.
                return;
            }

            player.IsInjured = false;
            player.InjuryStatus = null;
            player.InjuryKind = InjuryKind.None;
            player.InjuryShortDescription = null;
            player.InjuryLongDescription = null;
            player.InjuryType = null;
            player.InjuryDetail = null;
            player.InjurySide = null;
            player.InjuryReturnDate = null;
            player.InjuryFantasyStatus = null;
            player.InjuryUpdatedAt = now;
        }

        private static string NormalizeName(string first, string last)
        {
            var combined = $"{first} {last}";

            var normalized = combined
                .Normalize(System.Text.NormalizationForm.FormD);

            var builder = new System.Text.StringBuilder(normalized.Length);

            foreach (var c in normalized)
            {
                if (System.Globalization.CharUnicodeInfo.GetUnicodeCategory(c)
                    != System.Globalization.UnicodeCategory.NonSpacingMark)
                {
                    builder.Append(c);
                }
            }

            return builder
                .ToString()
                .Normalize(System.Text.NormalizationForm.FormC)
                .ToLowerInvariant()
                .Replace("-", "")
                .Replace("'", "")
                .Replace(".", "")
                .Replace(" ", "");
        }
    }

    /// <summary>
    /// Summary of a PlayerRosterStatus refresh.
    /// </summary>
    public class PlayerRosterStatusResult
    {
        public bool Enabled { get; set; }
        public string Message { get; set; } = string.Empty;

        public int TotalPlayers { get; set; }
        public int NhlPlayersFound { get; set; }
        public int AhlPlayersFound { get; set; }

        public int NhlRosterCount { get; set; }
        public int AhlRosterCount { get; set; }
        public int InjuredCount { get; set; }
        public int NotOnActiveRosterCount { get; set; }

        /// <summary>
        /// Hours since the last successful ESPN fetch, or null when it
        /// has never succeeded. Used by the frontend banner.
        /// </summary>
        public double? HoursSinceEspnSuccess { get; set; }

        /// <summary>True when 24h have passed without an ESPN success.</summary>
        public bool InjuryDataIsDegraded { get; set; }

        /// <summary>True when 48h have passed without an ESPN success.</summary>
        public bool InjuryDataIsStale { get; set; }

        /// <summary>
        /// Per-NHL-team count of distinct player IDs returned by the
        /// current-roster endpoint. Negative values mean the team
        /// failed: -1 HTTP error, -2 shape mismatch, -3 exception.
        /// </summary>
        public Dictionary<string, int> NhlPlayersPerTeam { get; set; } = new();
    }
}