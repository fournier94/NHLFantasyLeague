using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Services
{
    public class NhlPlayerResponse
    {
        [JsonPropertyName("playerId")]
        public int PlayerId { get; set; }

        [JsonPropertyName("isActive")]
        public bool IsActive { get; set; }

        [JsonPropertyName("currentTeamId")]
        public int? CurrentTeamId { get; set; }

        [JsonPropertyName("firstName")]
        public NhlLocalizedName FirstName { get; set; } = new();

        [JsonPropertyName("lastName")]
        public NhlLocalizedName LastName { get; set; } = new();

        [JsonPropertyName("position")]
        public string? Position { get; set; }

        [JsonPropertyName("headshot")]
        public string? Headshot { get; set; }

        [JsonPropertyName("heroImage")]
        public string? HeroImage { get; set; }

        [JsonPropertyName("birthDate")]
        public DateTime? BirthDate { get; set; }

        [JsonPropertyName("birthCity")]
        public NhlLocalizedName? BirthCity { get; set; }

        [JsonPropertyName("birthCountry")]
        public string? BirthCountry { get; set; }

        [JsonPropertyName("heightInInches")]
        public int? HeightInInches { get; set; }

        [JsonPropertyName("weightInPounds")]
        public int? WeightInPounds { get; set; }

        [JsonPropertyName("shootsCatches")]
        public string? ShootsCatches { get; set; }

        /// <summary>
        /// Draft details from the landing endpoint. Null for undrafted
        /// players.
        /// </summary>
        [JsonPropertyName("draftDetails")]
        public NhlDraftDetails? DraftDetails { get; set; }

        [JsonPropertyName("featuredStats")]
        public NhlFeaturedStats? FeaturedStats { get; set; }

        [JsonPropertyName("seasonTotals")]
        public List<NhlSeasonTotal> SeasonTotals { get; set; } = new();
    }

    public class NhlLocalizedName
    {
        [JsonPropertyName("default")]
        public string Default { get; set; } = string.Empty;
    }

    public class NhlDraftDetails
    {
        [JsonPropertyName("year")]
        public int Year { get; set; }

        [JsonPropertyName("teamAbbrev")]
        public string? TeamAbbrev { get; set; }

        [JsonPropertyName("round")]
        public int Round { get; set; }

        [JsonPropertyName("pickInRound")]
        public int PickInRound { get; set; }

        [JsonPropertyName("overallPick")]
        public int OverallPick { get; set; }
    }

    public class NhlFeaturedStats
    {
        [JsonPropertyName("season")]
        public int Season { get; set; }

        [JsonPropertyName("regularSeason")]
        public NhlRegularSeasonStats? RegularSeason { get; set; }
    }

    public class NhlRegularSeasonStats
    {
        [JsonPropertyName("subSeason")]
        public NhlPlayerStats? SubSeason { get; set; }
    }

    public class NhlPlayerStats
    {
        // --- Skater fields ---
        [JsonPropertyName("gamesPlayed")]
        public int GamesPlayed { get; set; }

        [JsonPropertyName("goals")]
        public int Goals { get; set; }

        [JsonPropertyName("assists")]
        public int Assists { get; set; }

        [JsonPropertyName("points")]
        public int Points { get; set; }

        [JsonPropertyName("plusMinus")]
        public int PlusMinus { get; set; }

        [JsonPropertyName("pim")]
        public int PenaltyMinutes { get; set; }

        [JsonPropertyName("powerPlayGoals")]
        public int PowerPlayGoals { get; set; }

        [JsonPropertyName("powerPlayPoints")]
        public int PowerPlayPoints { get; set; }

        [JsonPropertyName("shorthandedGoals")]
        public int ShorthandedGoals { get; set; }

        [JsonPropertyName("shorthandedPoints")]
        public int ShorthandedPoints { get; set; }

        [JsonPropertyName("gameWinningGoals")]
        public int GameWinningGoals { get; set; }

        [JsonPropertyName("otGoals")]
        public int OvertimeGoals { get; set; }

        [JsonPropertyName("shots")]
        public int Shots { get; set; }

        [JsonPropertyName("shootingPctg")]
        public decimal ShootingPercentage { get; set; }

        // --- Goalie fields ---
        [JsonPropertyName("wins")]
        public int Wins { get; set; }

        [JsonPropertyName("losses")]
        public int Losses { get; set; }

        [JsonPropertyName("otLosses")]
        public int OvertimeLosses { get; set; }

        [JsonPropertyName("shutouts")]
        public int Shutouts { get; set; }

        [JsonPropertyName("saves")]
        public int Saves { get; set; }

        [JsonPropertyName("shotsAgainst")]
        public int ShotsAgainst { get; set; }

        [JsonPropertyName("savePctg")]
        public decimal SavePercentage { get; set; }

        [JsonPropertyName("goalsAgainst")]
        public int GoalsAgainst { get; set; }

        [JsonPropertyName("goalsAgainstAvg")]
        public decimal GoalsAgainstAverage { get; set; }
    }
}