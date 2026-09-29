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

        [JsonPropertyName("details")]
        public NhlInjuryDetails? Details { get; set; }

        [JsonPropertyName("type")]
        public NhlInjuryType? Type { get; set; }

        [JsonPropertyName("date")]
        public DateTime? Date { get; set; }
    }

    public class NhlInjuryDetails
    {
        [JsonPropertyName("fantasyStatus")]
        public NhlInjuryFantasyStatus? FantasyStatus { get; set; }

        [JsonPropertyName("type")]
        public string? Type { get; set; }

        [JsonPropertyName("detail")]
        public string? Detail { get; set; }

        [JsonPropertyName("side")]
        public string? Side { get; set; }

        [JsonPropertyName("returnDate")]
        public DateOnly? ReturnDate { get; set; }
    }

    public class NhlInjuryFantasyStatus
    {
        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("abbreviation")]
        public string? Abbreviation { get; set; }
    }

    public class NhlInjuryType
    {
        [JsonPropertyName("name")]
        public string? Name { get; set; }

        [JsonPropertyName("description")]
        public string? Description { get; set; }

        [JsonPropertyName("abbreviation")]
        public string? Abbreviation { get; set; }
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