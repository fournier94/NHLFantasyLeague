namespace NhlFantasyLeague.api.Models
{
    public class PlayerGameLog
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public string Season { get; set; } = string.Empty;

        public DateOnly GameDate { get; set; }

        public int NhlTeamId { get; set; }

        public NhlTeam NhlTeam { get; set; } = null!;

        public int OpponentNhlTeamId { get; set; }

        public NhlTeam OpponentNhlTeam { get; set; } = null!;

        public bool IsHomeGame { get; set; }

        public int Goals { get; set; }

        public int Assists { get; set; }

        public int Points { get; set; }

        public int GamesPlayed { get; set; }

        public int FantasyPoints { get; set; }
    }
}