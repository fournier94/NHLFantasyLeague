namespace NhlFantasyLeague.api.Models
{
    public class DraftSelection
    {
        public int Id { get; set; }

        public int DraftId { get; set; }

        public Draft Draft { get; set; } = null!;

        public int DraftPickId { get; set; }

        public DraftPick DraftPick { get; set; } = null!;

        public int FantasyTeamId { get; set; }

        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public DateTime SelectedAt { get; set; }
    }
}