namespace NhlFantasyLeague.api.Models
{
    public class TradeItem
    {
        public int Id { get; set; }

        public int TradeId { get; set; }

        public Trade Trade { get; set; } = null!;

        public int FromFantasyTeamId { get; set; }

        public FantasyTeam FromFantasyTeam { get; set; } = null!;

        public int? PlayerId { get; set; }

        public Player? Player { get; set; }

        public int? DraftPickId { get; set; }

        public DraftPick? DraftPick { get; set; }

        public bool IsProspect { get; set; }
    }
}