namespace NhlFantasyLeague.api.Models
{
    public class FantasyTeam
    {
        public int Id { get; set; }

        public string Name { get; set; } = string.Empty;

        public int LeagueId { get; set; }

        public League League { get; set; } = null!;
    }
}