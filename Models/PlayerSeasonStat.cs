namespace NhlFantasyLeague.api.Models
{
    public class PlayerSeasonStat
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

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