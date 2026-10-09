using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Services
{
    // -----------------------------------------------------------------
    // Standings (/v1/standings/now)
    //
    // Full response shape. Every field below is one the API actually
    // returns; where the NHL omits a field for a given team (clinch
    // indicator, streak code early in the season), the property is
    // nullable and the sync writes null.
    // -----------------------------------------------------------------

    public class NhlStandingsResponse
    {
        [JsonPropertyName("standings")]
        public List<NhlTeamResponse> Standings { get; set; } = new();
    }

    public class NhlTeamResponse
    {
        // ---- Identity ----

        [JsonPropertyName("teamAbbrev")]
        public NhlLocalizedName TeamAbbrev { get; set; } = new();

        [JsonPropertyName("teamName")]
        public NhlLocalizedName TeamName { get; set; } = new();

        [JsonPropertyName("teamCommonName")]
        public NhlLocalizedName TeamCommonName { get; set; } = new();

        [JsonPropertyName("teamPlaceNameWithPreposition")]
        public NhlLocalizedName TeamPlaceNameWithPreposition { get; set; } = new();

        [JsonPropertyName("teamLogo")]
        public string? TeamLogo { get; set; }

        // ---- Conference / division ----

        [JsonPropertyName("conferenceName")]
        public string? ConferenceName { get; set; }

        [JsonPropertyName("conferenceAbbrev")]
        public string? ConferenceAbbrev { get; set; }

        [JsonPropertyName("divisionName")]
        public string? DivisionName { get; set; }

        [JsonPropertyName("divisionAbbrev")]
        public string? DivisionAbbrev { get; set; }

        // ---- Record ----

        [JsonPropertyName("gamesPlayed")]
        public int GamesPlayed { get; set; }

        [JsonPropertyName("wins")]
        public int Wins { get; set; }

        [JsonPropertyName("losses")]
        public int Losses { get; set; }

        [JsonPropertyName("otLosses")]
        public int OtLosses { get; set; }

        [JsonPropertyName("ties")]
        public int Ties { get; set; }

        [JsonPropertyName("points")]
        public int Points { get; set; }

        [JsonPropertyName("pointPctg")]
        public decimal PointPctg { get; set; }

        [JsonPropertyName("gamesRemaining")]
        public int GamesRemaining { get; set; }

        // ---- Goals ----

        [JsonPropertyName("goalsFor")]
        public int GoalsFor { get; set; }

        [JsonPropertyName("goalsAgainst")]
        public int GoalsAgainst { get; set; }

        [JsonPropertyName("goalDifferential")]
        public int GoalDifferential { get; set; }

        // ---- Home / road / last-10 splits ----

        [JsonPropertyName("homeWins")]
        public int HomeWins { get; set; }

        [JsonPropertyName("homeLosses")]
        public int HomeLosses { get; set; }

        [JsonPropertyName("homeOtLosses")]
        public int HomeOtLosses { get; set; }

        [JsonPropertyName("roadWins")]
        public int RoadWins { get; set; }

        [JsonPropertyName("roadLosses")]
        public int RoadLosses { get; set; }

        [JsonPropertyName("roadOtLosses")]
        public int RoadOtLosses { get; set; }

        [JsonPropertyName("l10Wins")]
        public int L10Wins { get; set; }

        [JsonPropertyName("l10Losses")]
        public int L10Losses { get; set; }

        [JsonPropertyName("l10OtLosses")]
        public int L10OtLosses { get; set; }

        // ---- Streak ----

        [JsonPropertyName("streakCode")]
        public string? StreakCode { get; set; }

        [JsonPropertyName("streakCount")]
        public int StreakCount { get; set; }

        // ---- Ranks ----

        [JsonPropertyName("leagueSequence")]
        public int LeagueSequence { get; set; }

        [JsonPropertyName("conferenceSequence")]
        public int ConferenceSequence { get; set; }

        [JsonPropertyName("divisionSequence")]
        public int DivisionSequence { get; set; }

        [JsonPropertyName("wildcardSequence")]
        public int WildcardSequence { get; set; }

        // ---- Indicators ----

        [JsonPropertyName("clinchIndicator")]
        public string? ClinchIndicator { get; set; }

        [JsonPropertyName("wildcardIndicator")]
        public bool WildcardIndicator { get; set; }

        // ---- Shootout ----

        [JsonPropertyName("shootoutWins")]
        public int ShootoutWins { get; set; }

        [JsonPropertyName("shootoutLosses")]
        public int ShootoutLosses { get; set; }
    }

    // -----------------------------------------------------------------
    // Team metadata (/stats/rest/en/team)
    // -----------------------------------------------------------------

    public class NhlTeamMetadataResponse
    {
        [JsonPropertyName("data")]
        public List<NhlTeamMetadata> Data { get; set; } = new();
    }

    public class NhlTeamMetadata
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("franchiseId")]
        public int? FranchiseId { get; set; }

        [JsonPropertyName("fullName")]
        public string FullName { get; set; } = string.Empty;

        [JsonPropertyName("triCode")]
        public string TriCode { get; set; } = string.Empty;

        [JsonPropertyName("leagueId")]
        public int? LeagueId { get; set; }

        [JsonPropertyName("officialSiteUrl")]
        public string? OfficialSiteUrl { get; set; }
    }

    // -----------------------------------------------------------------
    // Team summary (/stats/rest/en/team/summary)
    //
    // One row per team per season. Provides the percentages and
    // per-game averages that the standings endpoint does not carry.
    // The endpoint returns only the current season, which is all we
    // need (Step 1 decision: current season only).
    // -----------------------------------------------------------------

    public class NhlTeamSummaryResponse
    {
        [JsonPropertyName("data")]
        public List<NhlTeamSummary> Data { get; set; } = new();
    }

    public class NhlTeamSummary
    {
        [JsonPropertyName("teamId")]
        public int TeamId { get; set; }

        [JsonPropertyName("teamFullName")]
        public string TeamFullName { get; set; } = string.Empty;

        [JsonPropertyName("teamAbbrev")]
        public string TeamAbbrev { get; set; } = string.Empty;

        [JsonPropertyName("gamesPlayed")]
        public int GamesPlayed { get; set; }

        [JsonPropertyName("wins")]
        public int Wins { get; set; }

        [JsonPropertyName("losses")]
        public int Losses { get; set; }

        [JsonPropertyName("otLosses")]
        public int OtLosses { get; set; }

        [JsonPropertyName("points")]
        public int Points { get; set; }

        [JsonPropertyName("pointPctg")]
        public decimal PointPctg { get; set; }

        [JsonPropertyName("goalsFor")]
        public int GoalsFor { get; set; }

        [JsonPropertyName("goalsAgainst")]
        public int GoalsAgainst { get; set; }

        [JsonPropertyName("goalsForPerGame")]
        public decimal GoalsForPerGame { get; set; }

        [JsonPropertyName("goalsAgainstPerGame")]
        public decimal GoalsAgainstPerGame { get; set; }

        [JsonPropertyName("powerPlayPct")]
        public decimal PowerPlayPct { get; set; }

        [JsonPropertyName("powerPlayNetPct")]
        public decimal PowerPlayNetPct { get; set; }

        [JsonPropertyName("penaltyKillPct")]
        public decimal PenaltyKillPct { get; set; }

        [JsonPropertyName("penaltyKillNetPct")]
        public decimal PenaltyKillNetPct { get; set; }

        [JsonPropertyName("faceoffWinPct")]
        public decimal FaceoffWinPct { get; set; }

        [JsonPropertyName("shotsForPerGame")]
        public decimal ShotsForPerGame { get; set; }

        [JsonPropertyName("shotsAgainstPerGame")]
        public decimal ShotsAgainstPerGame { get; set; }

        [JsonPropertyName("penaltyMinutesPerGame")]
        public decimal PenaltyMinutesPerGame { get; set; }
    }

    // -----------------------------------------------------------------
    // Franchises (/stats/rest/en/franchise)
    // -----------------------------------------------------------------

    public class NhlFranchiseResponse
    {
        [JsonPropertyName("data")]
        public List<NhlFranchise> Data { get; set; } = new();
    }

    public class NhlFranchise
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("fullName")]
        public string FullName { get; set; } = string.Empty;

        [JsonPropertyName("teamCommonName")]
        public string? TeamCommonName { get; set; }

        [JsonPropertyName("teamPlaceName")]
        public string? TeamPlaceName { get; set; }

        [JsonPropertyName("firstSeasonId")]
        public int? FirstSeasonId { get; set; }

        [JsonPropertyName("mostRecentTeamId")]
        public int? MostRecentTeamId { get; set; }
    }
}