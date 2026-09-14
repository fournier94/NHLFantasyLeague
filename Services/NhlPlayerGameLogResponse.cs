using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Services
{
    public class NhlPlayerGameLogResponse
    {
        [JsonPropertyName("gameLog")]
        public List<NhlGameLogEntry> GameLog { get; set; } = new();
    }

    public class NhlGameLogEntry
    {
        [JsonPropertyName("gameId")]
        public long GameId { get; set; }

        [JsonPropertyName("gameDate")]
        public DateOnly GameDate { get; set; }

        [JsonPropertyName("teamAbbrev")]
        public string TeamAbbreviation { get; set; } = string.Empty;

        [JsonPropertyName("opponentAbbrev")]
        public string OpponentAbbreviation { get; set; } = string.Empty;

        [JsonPropertyName("homeRoadFlag")]
        public string HomeRoadFlag { get; set; } = string.Empty;

        [JsonPropertyName("goals")]
        public int Goals { get; set; }

        [JsonPropertyName("assists")]
        public int Assists { get; set; }

        [JsonPropertyName("points")]
        public int Points { get; set; }

        [JsonPropertyName("decision")]
        public string? Decision { get; set; }

        [JsonPropertyName("shutouts")]
        public int Shutouts { get; set; }

        [JsonPropertyName("gamesStarted")]
        public int GamesStarted { get; set; }

        [JsonPropertyName("goalsAgainst")]
        public int GoalsAgainst { get; set; }

        [JsonPropertyName("shotsAgainst")]
        public int ShotsAgainst { get; set; }

        [JsonPropertyName("savePctg")]
        public decimal SavePercentage { get; set; }
    }
}