namespace NhlFantasyLeague.api.Models
{
    public class SeasonStanding
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public int FantasyTeamId { get; set; }

        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int Wins { get; set; }

        public int Losses { get; set; }

        public int Points { get; set; }

        public int Rank { get; set; }
    }
}