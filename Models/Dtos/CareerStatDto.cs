namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One row of a player's career history, used by the player detail page.
    /// Mirrors PlayerCareerStat directly: every season, every league, every
    /// game type, one row per Sequence (a mid-season trade has several).
    /// </summary>
    public class CareerStatDto
    {
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
    }
}