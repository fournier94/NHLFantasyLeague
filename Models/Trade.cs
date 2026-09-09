namespace NhlFantasyLeague.api.Models
{
    public class Trade
    {
        public int Id { get; set; }

        public DateTime Date { get; set; }

        public int FromFantasyTeamId { get; set; }

        public FantasyTeam FromFantasyTeam { get; set; } = null!;

        public int ToFantasyTeamId { get; set; }

        public FantasyTeam ToFantasyTeam { get; set; } = null!;

        public string? Notes { get; set; }
    }
}