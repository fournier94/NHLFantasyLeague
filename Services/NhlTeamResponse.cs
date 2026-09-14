using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Services
{
    public class NhlTeamResponse
    {
        [JsonPropertyName("teamAbbrev")]
        public NhlLocalizedName TeamAbbrev { get; set; } = new();

        [JsonPropertyName("teamName")]
        public NhlLocalizedName TeamName { get; set; } = new();

        [JsonPropertyName("teamLogo")]
        public string? TeamLogo { get; set; }
    }

    public class NhlTeamMetadataResponse
    {
        public List<NhlTeamMetadata> Data { get; set; } = new();
    }

    public class NhlTeamMetadata
    {
        public int Id { get; set; }

        public string FullName { get; set; } = string.Empty;

        public string TriCode { get; set; } = string.Empty;
    }

    public class NhlStandingsResponse
    {
        [JsonPropertyName("standings")]
        public List<NhlTeamResponse> Standings { get; set; } = new();
    }
}