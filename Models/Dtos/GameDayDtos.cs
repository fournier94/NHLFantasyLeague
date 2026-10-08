using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Response of GET /api/games/today and GET /api/games/by-date/{date}.
    /// Summarizes today's games without the full boxscore payload
    /// (which can be large) so the Game Day list endpoint stays small.
    ///
    /// Carries two extra date fields that the frontend uses as its
    /// single source of truth for the "Aujourd'hui" / "Hier" day
    /// boundary, so the SPA never has to recompute the 3 AM ET cutoff
    /// in JavaScript and drift from the backend.
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

        /// <summary>
        /// Current "fantasy date" in ET: the real ET calendar date,
        /// except between 00:00 and 03:00 ET, when it stays on the
        /// previous ET calendar day.
        ///
        /// This is what the frontend uses for the "Aujourd'hui" and
        /// "Hier" columns. The 3 AM ET cutoff exists so a manager
        /// watching a late West Coast game that started at 22:30 ET
        /// is not told at 00:01 ET that the still-running game has
        /// become "hier".
        ///
        /// The frontend should:
        ///   - "Aujourd'hui" = games whose ET start date equals this
        ///   - "Hier"        = games whose ET start date equals this
        ///                     minus one
        ///
        /// Not used for computing PlayerGameLog.GameDate or for job
        /// scheduling. Those use the real ET calendar day.
        /// </summary>
        public DateOnly CurrentFantasyDate { get; set; }

        /// <summary>
        /// Real ET calendar date right now. No 3 AM cutoff applied.
        ///
        /// Included so the frontend can:
        ///   - detect the 3 AM rollover for cache invalidation and
        ///     forced refetch, and
        ///   - render the Game Day date picker's "today" reliably,
        ///     even in the 00:00-03:00 ET window when
        ///     CurrentFantasyDate is still on the previous day.
        ///
        /// It is also useful for debugging: it lets you see at a
        /// glance whether the current instant is inside the
        /// fantasy-day cutoff window.
        /// </summary>
        public DateOnly CurrentEtDate { get; set; }

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