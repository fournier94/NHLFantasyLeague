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

        /// <summary>
        /// Time on ice in this game, formatted "MM:SS". Null for rows
        /// saved before the column was added, or when the NHL API does
        /// not provide a value.
        /// </summary>
        public string? TimeOnIce { get; set; }

        public bool HatTrick { get; set; }

        public bool GoalieWin { get; set; }

        /// <summary>
        /// True when the goalie took the loss in this game. Set only
        /// on FINAL/OFF. Needed so the live-delta logic can tell a
        /// transition into a loss from a no-op tick.
        /// </summary>
        public bool GoalieLoss { get; set; }

        public bool GoalieOvertimeLoss { get; set; }

        public bool Shutout { get; set; }

        public int GoalsAgainst { get; set; }

        public int ShotsAgainst { get; set; }

        /// <summary>
        /// Saves made in this game. Stored so career totals can be
        /// queried from the game log without recomputing from
        /// ShotsAgainst - GoalsAgainst.
        /// </summary>
        public int Saves { get; set; }

        /// <summary>
        /// Save percentage for this game. Stored as a decimal (0.912),
        /// matching the format returned by the NHL API.
        /// </summary>
        public decimal SavePercentage { get; set; }

        public int FantasyPoints { get; set; }
    }
}