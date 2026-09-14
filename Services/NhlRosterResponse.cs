using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Services
{
    public class NhlRosterResponse
    {
        [JsonPropertyName("forwards")]
        public List<NhlRosterPlayer> Forwards { get; set; } = new();

        [JsonPropertyName("defensemen")]
        public List<NhlRosterPlayer> Defensemen { get; set; } = new();

        [JsonPropertyName("goalies")]
        public List<NhlRosterPlayer> Goalies { get; set; } = new();
    }

    public class NhlRosterPlayer
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("firstName")]
        public NhlLocalizedName FirstName { get; set; } = new();

        [JsonPropertyName("lastName")]
        public NhlLocalizedName LastName { get; set; } = new();

        [JsonPropertyName("positionCode")]
        public string? PositionCode { get; set; }

        [JsonPropertyName("headshot")]
        public string? Headshot { get; set; }
    }
}