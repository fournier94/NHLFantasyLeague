namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One season of statistics for a player, in one league and one game
    /// type. Rows are unique per (PlayerId, SeasonId, LeagueAbbreviation,
    /// GameTypeId); a mid-season trade is summed into a single row.
    /// </summary>
    public class PlayerSeasonStat
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        /// <summary>
        /// League the stats were recorded in ("NHL", "AHL", "SHL", ...).
        /// Defaults to NHL for rows created before this column existed.
        /// </summary>
        public string LeagueAbbreviation { get; set; } = "NHL";

        /// <summary>
        /// Team name as returned by the NHL API, or null when unknown.
        /// </summary>
        public string? TeamName { get; set; }

        /// <summary>
        /// 2 = regular season, 3 = playoffs. Matches the NHL API.
        /// </summary>
        public int GameTypeId { get; set; } = 2;

        public int GamesPlayed { get; set; }

        public int Goals { get; set; }

        public int Assists { get; set; }

        public int Points { get; set; }

        public int PlusMinus { get; set; }

        public int PenaltyMinutes { get; set; }

        public int PowerPlayGoals { get; set; }

        public int PowerPlayPoints { get; set; }

        public int GameWinningGoals { get; set; }

        public int Shots { get; set; }

        public decimal ShootingPercentage { get; set; }

        public int Wins { get; set; }

        public int Losses { get; set; }

        public int OvertimeLosses { get; set; }

        public int Shutouts { get; set; }

        public int HatTricks { get; set; }

        public int FantasyPoints { get; set; }

        public int Saves { get; set; }

        public int ShotsAgainst { get; set; }

        public decimal SavePercentage { get; set; }

        public int GoalsAgainst { get; set; }

        public decimal GoalsAgainstAverage { get; set; }
    }
}