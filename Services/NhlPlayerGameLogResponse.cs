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
        public DateOnly? GameDate { get; set; }

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

        /// <summary>Penalty minutes in this game.</summary>
        [JsonPropertyName("pim")]
        public int PenaltyMinutes { get; set; }

        /// <summary>Plus/minus in this game.</summary>
        [JsonPropertyName("plusMinus")]
        public int PlusMinus { get; set; }

        /// <summary>Shots on goal in this game.</summary>
        [JsonPropertyName("shots")]
        public int Shots { get; set; }

        /// <summary>
        /// Time on ice in this game, formatted "MM:SS". Populated for
        /// every skater and goalie who dressed. Null when the NHL API
        /// has not yet published it (rare, mostly pre-game) or for a
        /// game with no per-player entry.
        /// </summary>
        [JsonPropertyName("toi")]
        public string? TimeOnIce { get; set; }

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