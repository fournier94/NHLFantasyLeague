using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Services
{
    public class NhlPlayerIdResponse
    {
        [JsonPropertyName("data")]
        public List<NhlPlayerIdData> Data { get; set; } = new();

        [JsonPropertyName("total")]
        public int Total { get; set; }
    }

    public class NhlPlayerIdData
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }
    }
}