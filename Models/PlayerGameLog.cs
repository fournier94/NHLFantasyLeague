namespace NhlFantasyLeague.api.Models
{
    public class PlayerGameLog
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public DateOnly GameDate { get; set; }

        public long NhlGameId { get; set; }

        public int NhlTeamId { get; set; }

        public NhlTeam NhlTeam { get; set; } = null!;

        public int OpponentNhlTeamId { get; set; }

        public NhlTeam OpponentNhlTeam { get; set; } = null!;

        public bool IsHomeGame { get; set; }

        public int Goals { get; set; }

        public int Assists { get; set; }

        public int Points { get; set; }

        public bool HatTrick { get; set; }

        public bool GoalieWin { get; set; }

        public bool GoalieOvertimeLoss { get; set; }

        public bool Shutout { get; set; }

        public int GoalsAgainst { get; set; }

        public int ShotsAgainst { get; set; }

        public int FantasyPoints { get; set; }
    }
}