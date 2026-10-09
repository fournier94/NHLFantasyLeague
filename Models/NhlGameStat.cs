namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row per NHL game: the per-team shots and score for that
    /// game, plus enough identity to filter by date and season.
    ///
    /// Populated by the live refresh and post-game write, both of
    /// which already fetch the boxscore. Read by the Game Day page
    /// to display the shots line for past dates, where the NHL
    /// schedule endpoint does not carry shots.
    ///
    /// Upserted by NhlGameId. Not append-only: the live refresh
    /// updates the row in place as the game progresses.
    /// </summary>
    public class NhlGameStat
    {
        public int Id { get; set; }

        /// <summary>NHL API game id. Unique per game.</summary>
        public long NhlGameId { get; set; }

        /// <summary>NHL season code, e.g. 20262027.</summary>
        public int NhlSeasonCode { get; set; }

        /// <summary>2 = regular season, 3 = playoffs.</summary>
        public int GameTypeId { get; set; }

        /// <summary>ET calendar date the game started on.</summary>
        public DateOnly GameDate { get; set; }

        /// <summary>NHL API id of the away team.</summary>
        public int AwayNhlTeamId { get; set; }

        /// <summary>NHL API id of the home team.</summary>
        public int HomeNhlTeamId { get; set; }

        public int AwayScore { get; set; }
        public int HomeScore { get; set; }

        public int AwayShotsOnGoal { get; set; }
        public int HomeShotsOnGoal { get; set; }

        /// <summary>UTC instant of the last write.</summary>
        public DateTime LastUpdatedUtc { get; set; } = DateTime.UtcNow;
    }
}