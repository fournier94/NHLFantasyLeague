namespace NhlFantasyLeague.api.Models
{
    public class KeeperSelection
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public int FantasyTeamId { get; set; }

        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int SelectionOrder { get; set; }
    }
}