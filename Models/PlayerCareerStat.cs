namespace NhlFantasyLeague.api.Models
{
    public class PlayerCareerStat
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int Season { get; set; }

        public int GameTypeId { get; set; }

        public int Sequence { get; set; }

        public string LeagueAbbreviation { get; set; } = string.Empty;

        public string? TeamName { get; set; }

        public int GamesPlayed { get; set; }

        public int GamesStarted { get; set; }

        public int Goals { get; set; }

        public int Assists { get; set; }

        public int Points { get; set; }

        public int PlusMinus { get; set; }

        public int PenaltyMinutes { get; set; }

        public int PowerPlayGoals { get; set; }

        public int PowerPlayPoints { get; set; }

        public int ShorthandedGoals { get; set; }

        public int ShorthandedPoints { get; set; }

        public int GameWinningGoals { get; set; }

        public int OvertimeGoals { get; set; }

        public int Shots { get; set; }

        public decimal ShootingPercentage { get; set; }

        public string? AverageTimeOnIce { get; set; }

        public decimal? FaceoffWinningPercentage { get; set; }

        public int Wins { get; set; }

        public int Losses { get; set; }

        public int OvertimeLosses { get; set; }

        public int Shutouts { get; set; }

        public int Saves { get; set; }

        public int ShotsAgainst { get; set; }

        public decimal SavePercentage { get; set; }

        public int GoalsAgainst { get; set; }

        public decimal GoalsAgainstAverage { get; set; }

        /// <summary>
        /// Number of hat tricks (3+ goals) recorded in the game logs for
        /// this season and game type. For a season that was split across
        /// multiple Sequence rows (mid-season trade), the full season
        /// total is written on the lowest Sequence row and 0 is written
        /// on the other rows, so summing the column never double-counts.
        ///
        /// Null when the NHL API no longer serves the game log for this
        /// season, or when the backfill endpoint has not run yet.
        /// </summary>
        public int? HatTricks { get; set; }

        /// <summary>
        /// UTC timestamp of the last successful hat-trick backfill for
        /// this row. Null means "not computed yet"; the backfill endpoint
        /// uses this to skip rows it has already handled.
        /// </summary>
        public DateTime? HatTricksComputedAt { get; set; }
    }
}