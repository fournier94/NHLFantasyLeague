namespace NhlFantasyLeague.api.Models
{
    public class FantasyMatchup
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public int WeekNumber { get; set; }

        public DateOnly WeekStart { get; set; }

        public DateOnly WeekEnd { get; set; }

        public int HomeFantasyTeamId { get; set; }

        public FantasyTeam HomeFantasyTeam { get; set; } = null!;

        public int AwayFantasyTeamId { get; set; }

        public FantasyTeam AwayFantasyTeam { get; set; } = null!;

        public int HomeScore { get; set; }

        public int AwayScore { get; set; }

        public int? WinnerFantasyTeamId { get; set; }

        public FantasyTeam? WinnerFantasyTeam { get; set; }
    }
}