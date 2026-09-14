namespace NhlFantasyLeague.api.Models
{
    public class RosterEntry
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int FantasyTeamId { get; set; }

        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public RosterStatus RosterStatus { get; set; }

        public decimal FantasySalary { get; set; }
        public int RosterSlot { get; set; }
    }
}