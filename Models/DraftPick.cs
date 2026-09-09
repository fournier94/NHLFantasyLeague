namespace NhlFantasyLeague.api.Models
{
    public class DraftPick
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public int Round { get; set; }

        public int PickNumber { get; set; }

        public int CurrentOwnerFantasyTeamId { get; set; }

        public FantasyTeam CurrentOwnerFantasyTeam { get; set; } = null!;
    }
}