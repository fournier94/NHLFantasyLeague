namespace NhlFantasyLeague.api.Models
{
    public class FantasyTeamSeason
    {
        public int Id { get; set; }

        public int FantasyTeamId { get; set; }

        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public bool IsActive { get; set; }
    }
}