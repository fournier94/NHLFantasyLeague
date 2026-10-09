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
        /// </summary>
        public DateOnly CurrentFantasyDate { get; set; }

        /// <summary>
        /// Real ET calendar date right now. No 3 AM cutoff applied.
        /// </summary>
        public DateOnly CurrentEtDate { get; set; }

        public List<GameDayGameSummary> Games { get; set; } = new();
    }

    /// <summary>
    /// One game as shown on the Game Day page's list.
    ///
    /// Carries the schedule-level summary (teams, score, state) plus
    /// the identity and record fields that the banner-style game
    /// card renders. All the extra fields are enriched at request
    /// time in GamesController by joining the cached schedule
    /// against NhlTeams + NhlTeamSeasonStats. The live cache itself
    /// stays lean and untouched.
    /// </summary>
    public class GameDayGameSummary
    {
        public long GameId { get; set; }
        public DateOnly GameDate { get; set; }
        public DateTime StartTimeUtc { get; set; }

        /// <summary>FUT, PRE, LIVE, CRIT, FINAL.</summary>
        public string GameState { get; set; } = string.Empty;

        // ---- Away side ----

        public string AwayAbbreviation { get; set; } = string.Empty;
        public string AwayFullName { get; set; } = string.Empty;
        public string AwayCommonName { get; set; } = string.Empty;
        public string AwayPlaceName { get; set; } = string.Empty;

        /// <summary>Record in W-L-OTL format, e.g. "10-5-2". Null
        /// when the team has no NhlTeamSeasonStat row yet (e.g.
        /// before the first daily sync has run).</summary>
        public string? AwayRecord { get; set; }

        public string? AwayArenaName { get; set; }

        public int? AwayScore { get; set; }

        /// <summary>
        /// Shots on goal for the away team. Populated from the cached
        /// boxscore for games that have one (LIVE, CRIT, FINAL, OFF).
        /// Null for FUT / PRE games and for games whose boxscore the
        /// live cache has never fetched. The Game Day card hides the
        /// shots row when this is null.
        /// </summary>
        public int? AwayShots { get; set; }

        // ---- Home side ----

        public string HomeAbbreviation { get; set; } = string.Empty;
        public string HomeFullName { get; set; } = string.Empty;
        public string HomeCommonName { get; set; } = string.Empty;
        public string HomePlaceName { get; set; } = string.Empty;

        /// <summary>Record in W-L-OTL format, e.g. "12-4-1". Null
        /// when the team has no NhlTeamSeasonStat row yet.</summary>
        public string? HomeRecord { get; set; }

        /// <summary>The arena the game is played in. Always the
        /// home team's arena.</summary>
        public string? HomeArenaName { get; set; }

        public int? HomeScore { get; set; }

        /// <summary>
        /// Shots on goal for the home team. Same rule as AwayShots.
        /// </summary>
        public int? HomeShots { get; set; }

        // ---- Game state ----

        /// <summary>Null before the first period.</summary>
        public int? PeriodNumber { get; set; }

        /// <summary>REG, OT or SO. Null before the first period.</summary>
        public string? PeriodType { get; set; }

        /// <summary>
        /// Time remaining in the current period, formatted "MM:SS".
        /// Populated from the cached boxscore's live clock for games
        /// that are currently LIVE or CRIT. Null for scheduled games,
        /// final games (the clock is no longer meaningful), and past
        /// dates where no boxscore is cached.
        /// </summary>
        public string? PeriodTimeRemaining { get; set; }

        /// <summary>
        /// True when the game is between periods. Null when unknown
        /// (no cached boxscore, or the NHL has not started publishing
        /// a clock yet). The card renders "Entracte" when this is
        /// true and a period number is available.
        /// </summary>
        public bool? IsIntermission { get; set; }

        /// <summary>True when a boxscore is cached for this game.</summary>
        public bool HasBoxscore { get; set; }
    }
}