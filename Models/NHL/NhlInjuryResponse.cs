using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Models.NHL
{
    /// <summary>
    /// Top-level ESPN injuries payload.
    ///
    /// Shape:
    ///   {
    ///     "injuries": [
    ///       {
    ///         "id": "1",
    ///         "displayName": "Anaheim Ducks",
    ///         "injuries": [
    ///           {
    ///             "athlete": { "displayName": "Mason McTavish", "position": { "abbreviation": "C" } },
    ///             "status": "Out",
    ///             "shortComment": "...",
    ///             "longComment": "..."
    ///           }, ...
    ///         ]
    ///       }, ...
    ///     ]
    ///   }
    /// </summary>
    public class NhlInjuryResponse
    {
        [JsonPropertyName("injuries")]
        public List<NhlInjuryTeam> Teams { get; set; } = new();
    }

    public class NhlInjuryTeam
    {
        [JsonPropertyName("id")]
        public string? Id { get; set; }

        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }

        [JsonPropertyName("injuries")]
        public List<NhlInjuryPlayer> Players { get; set; } = new();
    }

    public class NhlInjuryPlayer
    {
        [JsonPropertyName("athlete")]
        public NhlInjuryAthlete? Athlete { get; set; }

        [JsonPropertyName("status")]
        public string? Status { get; set; }

        [JsonPropertyName("shortComment")]
        public string? ShortComment { get; set; }

        [JsonPropertyName("longComment")]
        public string? LongComment { get; set; }
    }

    public class NhlInjuryAthlete
    {
        [JsonPropertyName("displayName")]
        public string? DisplayName { get; set; }

        [JsonPropertyName("position")]
        public NhlInjuryPosition? Position { get; set; }
    }

    public class NhlInjuryPosition
    {
        [JsonPropertyName("abbreviation")]
        public string? Abbreviation { get; set; }
    }
}