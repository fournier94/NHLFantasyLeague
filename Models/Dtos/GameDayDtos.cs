using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Response of GET /api/games/today. Summarizes today's games
    /// without the full boxscore payload (which can be large) so the
    /// Game Day list endpoint stays small.
    /// </summary>
    public class GameDayScheduleResponse
    {
        /// <summary>
        /// UTC instant of the last live refresh that populated this
        /// data. Null when the cache has never been filled.
        /// </summary>
        public DateTime? LastRefreshUtc { get; set; }

        /// <summary>
        /// True when the schedule list reflects data fetched within
        /// the last 10 minutes.
        /// </summary>
        public bool IsFresh { get; set; }

        public List<GameDayGameSummary> Games { get; set; } = new();
    }

    /// <summary>
    /// One game as shown on the Game Day page's list. Contains just
    /// enough to render a row.
    /// </summary>
    public class GameDayGameSummary
    {
        public long GameId { get; set; }
        public DateOnly GameDate { get; set; }
        public DateTime StartTimeUtc { get; set; }

        /// <summary>FUT, PRE, LIVE, CRIT, FINAL.</summary>
        public string GameState { get; set; } = string.Empty;

        public string AwayAbbreviation { get; set; } = string.Empty;
        public string HomeAbbreviation { get; set; } = string.Empty;
        public int? AwayScore { get; set; }
        public int? HomeScore { get; set; }

        /// <summary>Null before the first period.</summary>
        public int? PeriodNumber { get; set; }

        /// <summary>REG, OT or SO. Null before the first period.</summary>
        public string? PeriodType { get; set; }

        /// <summary>True when a boxscore is cached for this game.</summary>
        public bool HasBoxscore { get; set; }
    }
}