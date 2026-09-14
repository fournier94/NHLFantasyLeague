namespace NhlFantasyLeague.api.Models
{
    public class League
    {
        public int Id { get; set; }

        public string Name { get; set; } = string.Empty;

        public int MaximumRosterSize { get; set; }

        public int ActiveForwardCount { get; set; }

        public int ActiveDefensemanCount { get; set; }

        public int ActiveGoalieCount { get; set; }

        public int BenchForwardCount { get; set; }

        public int BenchDefensemanCount { get; set; }

        public int BenchGoalieCount { get; set; }

        public int ProspectCount { get; set; }

        public int KeeperCount { get; set; }
        public ICollection<FantasyTeam> FantasyTeams { get; set; } = new List<FantasyTeam>();
    }
}