using System.Text.Json.Serialization;

namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Response from GET /v1/schedule/now or /v1/schedule/{date}.
    ///
    /// Both endpoints return the same shape: a gameWeek array covering
    /// the current week, with one entry per date. The entry whose
    /// Date matches today contains the games we care about.
    /// </summary>
    public class NhlScheduleResponse
    {
        [JsonPropertyName("nextStartDate")]
        public string? NextStartDate { get; set; }

        [JsonPropertyName("previousStartDate")]
        public string? PreviousStartDate { get; set; }

        [JsonPropertyName("gameWeek")]
        public List<NhlScheduleWeek> GameWeek { get; set; } = new();
    }

    public class NhlScheduleWeek
    {
        [JsonPropertyName("date")]
        public DateOnly Date { get; set; }

        [JsonPropertyName("dayAbbrev")]
        public string DayAbbrev { get; set; } = string.Empty;

        [JsonPropertyName("numberOfGames")]
        public int NumberOfGames { get; set; }

        [JsonPropertyName("games")]
        public List<NhlScheduleGame> Games { get; set; } = new();
    }

    public class NhlScheduleGame
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }

        [JsonPropertyName("season")]
        public int Season { get; set; }

        [JsonPropertyName("gameType")]
        public int GameType { get; set; }

        [JsonPropertyName("gameDate")]
        public DateOnly GameDate { get; set; }

        /// <summary>
        /// FUT = scheduled but not started, PRE = pre-game,
        /// LIVE = in progress, CRIT = in progress critical moment,
        /// FINAL = completed, OFF = no game today.
        /// </summary>
        [JsonPropertyName("gameState")]
        public string GameState { get; set; } = string.Empty;

        [JsonPropertyName("startTimeUTC")]
        public DateTime StartTimeUtc { get; set; }

        [JsonPropertyName("periodDescriptor")]
        public NhlPeriodDescriptor? PeriodDescriptor { get; set; }

        [JsonPropertyName("awayTeam")]
        public NhlScheduleTeam AwayTeam { get; set; } = new();

        [JsonPropertyName("homeTeam")]
        public NhlScheduleTeam HomeTeam { get; set; } = new();

        [JsonPropertyName("gameOutcome")]
        public NhlGameOutcome? GameOutcome { get; set; }
    }

    public class NhlPeriodDescriptor
    {
        [JsonPropertyName("number")]
        public int Number { get; set; }

        /// <summary>REG, OT, SO.</summary>
        [JsonPropertyName("periodType")]
        public string PeriodType { get; set; } = string.Empty;
    }

    public class NhlGameOutcome
    {
        [JsonPropertyName("lastPeriodType")]
        public string LastPeriodType { get; set; } = string.Empty;
    }

    public class NhlScheduleTeam
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("abbrev")]
        public string Abbreviation { get; set; } = string.Empty;

        [JsonPropertyName("logo")]
        public string? Logo { get; set; }

        [JsonPropertyName("score")]
        public int? Score { get; set; }
    }

    // =================================================================
    // Boxscore
    // =================================================================

    /// <summary>
    /// Response from GET /v1/gamecenter/{gameId}/boxscore.
    /// Contains the live score and the per-player stats for both teams.
    /// </summary>
    public class NhlBoxscoreResponse
    {
        [JsonPropertyName("id")]
        public long Id { get; set; }

        [JsonPropertyName("season")]
        public int Season { get; set; }

        [JsonPropertyName("gameType")]
        public int GameType { get; set; }

        [JsonPropertyName("gameDate")]
        public DateOnly GameDate { get; set; }

        [JsonPropertyName("gameState")]
        public string GameState { get; set; } = string.Empty;

        [JsonPropertyName("periodDescriptor")]
        public NhlPeriodDescriptor? PeriodDescriptor { get; set; }

        [JsonPropertyName("awayTeam")]
        public NhlBoxscoreTeam AwayTeam { get; set; } = new();

        [JsonPropertyName("homeTeam")]
        public NhlBoxscoreTeam HomeTeam { get; set; } = new();

        [JsonPropertyName("playerByGameStats")]
        public NhlPlayerByGameStats PlayerByGameStats { get; set; } = new();
    }

    public class NhlBoxscoreTeam
    {
        [JsonPropertyName("id")]
        public int Id { get; set; }

        [JsonPropertyName("abbrev")]
        public string Abbreviation { get; set; } = string.Empty;

        [JsonPropertyName("score")]
        public int Score { get; set; }

        /// <summary>Shots on goal for the whole team.</summary>
        [JsonPropertyName("sog")]
        public int ShotsOnGoal { get; set; }
    }

    public class NhlPlayerByGameStats
    {
        [JsonPropertyName("awayTeam")]
        public NhlTeamPlayerStats AwayTeam { get; set; } = new();

        [JsonPropertyName("homeTeam")]
        public NhlTeamPlayerStats HomeTeam { get; set; } = new();
    }

    public class NhlTeamPlayerStats
    {
        [JsonPropertyName("forwards")]
        public List<NhlSkaterStats> Forwards { get; set; } = new();

        [JsonPropertyName("defense")]
        public List<NhlSkaterStats> Defense { get; set; } = new();

        [JsonPropertyName("goalies")]
        public List<NhlGoalieStats> Goalies { get; set; } = new();
    }

    public class NhlSkaterStats
    {
        [JsonPropertyName("playerId")]
        public int PlayerId { get; set; }

        [JsonPropertyName("sweaterNumber")]
        public int? SweaterNumber { get; set; }

        [JsonPropertyName("name")]
        public NhlLocalizedName Name { get; set; } = new();

        [JsonPropertyName("position")]
        public string Position { get; set; } = string.Empty;

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

        [JsonPropertyName("hits")]
        public int Hits { get; set; }

        [JsonPropertyName("powerPlayGoals")]
        public int PowerPlayGoals { get; set; }

        [JsonPropertyName("shots")]
        public int Shots { get; set; }

        [JsonPropertyName("headshot")]
        public string? Headshot { get; set; }
    }

    public class NhlGoalieStats
    {
        [JsonPropertyName("playerId")]
        public int PlayerId { get; set; }

        [JsonPropertyName("sweaterNumber")]
        public int? SweaterNumber { get; set; }

        [JsonPropertyName("name")]
        public NhlLocalizedName Name { get; set; } = new();

        /// <summary>"W", "L", "O" for overtime loss, or null if he did not play.</summary>
        [JsonPropertyName("decision")]
        public string? Decision { get; set; }

        [JsonPropertyName("goals")]
        public int Goals { get; set; }

        [JsonPropertyName("assists")]
        public int Assists { get; set; }

        [JsonPropertyName("points")]
        public int Points { get; set; }

        [JsonPropertyName("goalsAgainst")]
        public int GoalsAgainst { get; set; }

        [JsonPropertyName("shotsAgainst")]
        public int ShotsAgainst { get; set; }

        [JsonPropertyName("saves")]
        public int Saves { get; set; }

        [JsonPropertyName("shutouts")]
        public int Shutouts { get; set; }

        [JsonPropertyName("savePctg")]
        public decimal SavePercentage { get; set; }

        [JsonPropertyName("starter")]
        public bool Starter { get; set; }
    }

    public class NhlLocalizedName
    {
        [JsonPropertyName("default")]
        public string Default { get; set; } = string.Empty;
    }
}