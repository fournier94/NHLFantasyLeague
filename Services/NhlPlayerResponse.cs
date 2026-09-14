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

        [JsonPropertyName("birthDate")]
        public DateTime? BirthDate { get; set; }

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
        [JsonPropertyName("gamesPlayed")]
        public int GamesPlayed { get; set; }

        [JsonPropertyName("goals")]
        public int Goals { get; set; }

        [JsonPropertyName("assists")]
        public int Assists { get; set; }

        [JsonPropertyName("points")]
        public int Points { get; set; }

        [JsonPropertyName("wins")]
        public int Wins { get; set; }

        [JsonPropertyName("overtimeLosses")]
        public int OvertimeLosses { get; set; }

        [JsonPropertyName("shutouts")]
        public int Shutouts { get; set; }
    }
}