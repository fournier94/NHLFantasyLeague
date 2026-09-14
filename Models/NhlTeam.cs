namespace NhlFantasyLeague.api.Models
{
    public class NhlTeam
    {
        public int Id { get; set; }

        public int NhlTeamId { get; set; }

        public string Name { get; set; } = string.Empty;

        public string Abbreviation { get; set; } = string.Empty;

        public string? LogoUrl { get; set; }

        public ICollection<Player> Players { get; set; } = new List<Player>();
    }
}