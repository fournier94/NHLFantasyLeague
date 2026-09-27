namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One game the player played, from the NHL game-log endpoint.
    /// Used for the "Dernières parties" table and for computing fantasy
    /// points and hat-tricks. One row per player per game.
    /// </summary>
    public class PlayerGameLog
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public long NhlGameId { get; set; }

        public DateOnly GameDate { get; set; }

        public int NhlTeamId { get; set; }

        public NhlTeam NhlTeam { get; set; } = null!;

        public int OpponentNhlTeamId { get; set; }

        public NhlTeam OpponentNhlTeam { get; set; } = null!;

        public bool IsHomeGame { get; set; }

        public int Goals { get; set; }

        public int Assists { get; set; }

        public int Points { get; set; }

        /// <summary>Penalty minutes in this game, from the NHL game log.</summary>
        public int PenaltyMinutes { get; set; }

        /// <summary>Plus/minus in this game, from the NHL game log.</summary>
        public int PlusMinus { get; set; }

        /// <summary>Shots on goal in this game, from the NHL game log.</summary>
        public int Shots { get; set; }

        public bool HatTrick { get; set; }

        public bool GoalieWin { get; set; }

        public bool GoalieOvertimeLoss { get; set; }

        public bool Shutout { get; set; }

        public int GoalsAgainst { get; set; }

        public int ShotsAgainst { get; set; }

        public int FantasyPoints { get; set; }
    }
}