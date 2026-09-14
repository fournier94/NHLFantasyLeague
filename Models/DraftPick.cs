namespace NhlFantasyLeague.api.Models
{
    public class DraftPick
    {
        public int Id { get; set; }

        public int DraftId { get; set; }

        public Draft Draft { get; set; } = null!;

        public int Round { get; set; }

        public int PickNumber { get; set; }

        public int OriginalOwnerFantasyTeamId { get; set; }

        public FantasyTeam OriginalOwnerFantasyTeam { get; set; } = null!;

        public int CurrentOwnerFantasyTeamId { get; set; }

        public FantasyTeam CurrentOwnerFantasyTeam { get; set; } = null!;
    }
}