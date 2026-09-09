namespace NhlFantasyLeague.api.Models
{
    public class PlayerSeasonStat
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public string Season { get; set; } = string.Empty;

        public int GamesPlayed { get; set; }

        public int Goals { get; set; }

        public int Assists { get; set; }

        public int Points { get; set; }

        public int Wins { get; set; }

        public int OvertimeLosses { get; set; }

        public int Shutouts { get; set; }

        public int HatTricks { get; set; }
    }
}