using NhlFantasyLeague.api.Services;
using System.Text.Json.Serialization;

public class NhlSeasonTotal
{
    [JsonPropertyName("season")]
    public int Season { get; set; }

    [JsonPropertyName("gameTypeId")]
    public int GameTypeId { get; set; }

    [JsonPropertyName("leagueAbbrev")]
    public string LeagueAbbrev { get; set; } = string.Empty;

    [JsonPropertyName("teamName")]
    public NhlLocalizedName? TeamName { get; set; }

    [JsonPropertyName("gamesPlayed")]
    public int GamesPlayed { get; set; }

    [JsonPropertyName("gamesStarted")]
    public int GamesStarted { get; set; }

    [JsonPropertyName("goals")]
    public int Goals { get; set; }

    [JsonPropertyName("assists")]
    public int Assists { get; set; }

    [JsonPropertyName("points")]
    public int Points { get; set; }

    [JsonPropertyName("goalsAgainst")]
    public int GoalsAgainst { get; set; }

    [JsonPropertyName("goalsAgainstAvg")]
    public decimal GoalsAgainstAverage { get; set; }

    [JsonPropertyName("losses")]
    public int Losses { get; set; }

    [JsonPropertyName("otLosses")]
    public int OvertimeLosses { get; set; }

    [JsonPropertyName("wins")]
    public int Wins { get; set; }

    [JsonPropertyName("shutouts")]
    public int Shutouts { get; set; }

    [JsonPropertyName("shotsAgainst")]
    public int ShotsAgainst { get; set; }

    [JsonPropertyName("savePctg")]
    public decimal SavePercentage { get; set; }

    [JsonPropertyName("pim")]
    public int PenaltyMinutes { get; set; }

    [JsonPropertyName("plusMinus")]
    public int PlusMinus { get; set; }

    [JsonPropertyName("powerPlayGoals")]
    public int PowerPlayGoals { get; set; }

    [JsonPropertyName("powerPlayPoints")]
    public int PowerPlayPoints { get; set; }

    [JsonPropertyName("gameWinningGoals")]
    public int GameWinningGoals { get; set; }

    [JsonPropertyName("shots")]
    public int Shots { get; set; }

    [JsonPropertyName("shootingPctg")]
    public decimal ShootingPercentage { get; set; }

    [JsonPropertyName("saves")]
    public int Saves { get; set; }
}