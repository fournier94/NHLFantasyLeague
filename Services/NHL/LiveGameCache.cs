using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// In-memory cache of today's live game data.
    ///
    /// WHY THIS EXISTS
    ///
    /// During live games, refreshing from the NHL API every 7 minutes
    /// is cheap (external, free, no auth). Writing that data to Neon
    /// every 7 minutes is expensive: each write wakes the compute and
    /// bills 5 minutes of CU-hours, and we have a 100 CU-hour/month
    /// budget. Over a 6-hour game window that is ~50 wake-ups, which
    /// alone would eat over half the monthly budget.
    ///
    /// Instead: hold the fresh data here, in the API process memory.
    /// The Game Day page reads from this cache. Nothing hits the DB
    /// during live games. Once the last game of the night finishes,
    /// ScheduledJobsHostedService runs one bulk write (post-game) that
    /// persists everything in a single transaction.
    ///
    /// The cache is a singleton: one per API process. It is lost on
    /// restart, which is acceptable — the next refresh tick repopulates
    /// it within 7 minutes, and the UI just shows a "loading" state.
    /// </summary>
    public class LiveGameCache
    {
        private readonly object _lock = new();
        private Dictionary<long, LiveGameSnapshot> _games = new();
        private DateTime _lastRefreshUtc = DateTime.MinValue;

        /// <summary>UTC instant of the last successful refresh.</summary>
        public DateTime LastRefreshUtc
        {
            get
            {
                lock (_lock)
                {
                    return _lastRefreshUtc;
                }
            }
        }

        /// <summary>True when the cache was refreshed within the given window.</summary>
        public bool IsFresh(TimeSpan maxAge)
        {
            lock (_lock)
            {
                return DateTime.UtcNow - _lastRefreshUtc <= maxAge;
            }
        }

        /// <summary>Replaces the entire game list and marks the cache fresh.</summary>
        public void Replace(IEnumerable<LiveGameSnapshot> games)
        {
            lock (_lock)
            {
                _games = games.ToDictionary(g => g.GameId);
                _lastRefreshUtc = DateTime.UtcNow;
            }
        }

        /// <summary>Returns every cached game, ordered by start time.</summary>
        public List<LiveGameSnapshot> GetAll()
        {
            lock (_lock)
            {
                return _games.Values
                    .OrderBy(g => g.StartTimeUtc)
                    .ToList();
            }
        }

        /// <summary>Returns one game by ID, or null when not cached.</summary>
        public LiveGameSnapshot? Get(long gameId)
        {
            lock (_lock)
            {
                return _games.TryGetValue(gameId, out var game)
                    ? game
                    : null;
            }
        }

        /// <summary>True when the cache holds a game with the given ID.</summary>
        public bool Contains(long gameId)
        {
            lock (_lock)
            {
                return _games.ContainsKey(gameId);
            }
        }
    }

    /// <summary>
    /// One game as held in the cache. Includes the schedule-level
    /// summary (teams, score, state) and the full boxscore when one
    /// has been fetched.
    ///
    /// The boxscore is nullable because the very first refresh of the
    /// day only pulls the schedule (nothing to show yet beyond the
    /// matchup). Boxscores are only attached for games in a state
    /// worth refreshing (LIVE, CRIT, FINAL).
    /// </summary>
    public class LiveGameSnapshot
    {
        public long GameId { get; set; }
        public DateOnly GameDate { get; set; }
        public int Season { get; set; }
        public int GameType { get; set; }
        public DateTime StartTimeUtc { get; set; }

        /// <summary>FUT, PRE, LIVE, CRIT, FINAL, OFF.</summary>
        public string GameState { get; set; } = string.Empty;

        public string AwayAbbreviation { get; set; } = string.Empty;
        public string HomeAbbreviation { get; set; } = string.Empty;
        public int? AwayScore { get; set; }
        public int? HomeScore { get; set; }

        /// <summary>Period number (1-3 for regulation, 4+ for OT/SO).</summary>
        public int? PeriodNumber { get; set; }

        /// <summary>REG, OT or SO. Null before the first period.</summary>
        public string? PeriodType { get; set; }

        /// <summary>Full boxscore when available, otherwise null.</summary>
        public NhlBoxscoreResponse? Boxscore { get; set; }
    }
}