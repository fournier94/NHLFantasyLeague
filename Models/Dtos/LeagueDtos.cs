namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// League overview returned by GET /api/league: the league settings,
    /// its seasons and its fantasy teams.
    /// </summary>
    public class LeagueSummaryDto
    {
        /// <summary>Database id of the league.</summary>
        public int Id { get; set; }

        /// <summary>League display name.</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>Maximum number of players per fantasy team (active + bench + prospects).</summary>
        public int MaximumRosterSize { get; set; }

        /// <summary>Number of active forwards per fantasy team.</summary>
        public int ActiveForwardCount { get; set; }

        /// <summary>Number of active defensemen per fantasy team.</summary>
        public int ActiveDefensemanCount { get; set; }

        /// <summary>Number of active goalies per fantasy team.</summary>
        public int ActiveGoalieCount { get; set; }

        /// <summary>Number of bench forwards per fantasy team.</summary>
        public int BenchForwardCount { get; set; }

        /// <summary>Number of bench defensemen per fantasy team.</summary>
        public int BenchDefensemanCount { get; set; }

        /// <summary>Number of bench goalies per fantasy team.</summary>
        public int BenchGoalieCount { get; set; }

        /// <summary>Number of prospects per fantasy team.</summary>
        public int ProspectCount { get; set; }

        /// <summary>Minimum number of players each DG must drop before the annual draft. DGs may drop more; they keep all players they do not drop.</summary>
        public int MinimumDropCount { get; set; }

        /// <summary>Every season of the league, ordered by NHL season code.</summary>
        public List<SeasonDto> Seasons { get; set; } = new List<SeasonDto>();

        /// <summary>Season that starts the latest, or null when none exists yet.</summary>
        public SeasonDto? CurrentSeason { get; set; }

        /// <summary>Every fantasy team, ordered by name.</summary>
        public List<FantasyTeamDto> Teams { get; set; } = new List<FantasyTeamDto>();
    }

    /// <summary>
    /// One fantasy season with its salary cap and floor.
    /// </summary>
    public class SeasonDto
    {
        /// <summary>Database id of the season.</summary>
        public int Id { get; set; }

        /// <summary>Display name, for example "2026-2027".</summary>
        public string Name { get; set; } = string.Empty;

        /// <summary>First day of the season.</summary>
        public DateOnly StartDate { get; set; }

        /// <summary>Last day of the season.</summary>
        public DateOnly EndDate { get; set; }

        /// <summary>Salary cap of the season, in dollars.</summary>
        public decimal SalaryCap { get; set; }

        /// <summary>Salary floor of the season, in dollars.</summary>
        public decimal SalaryFloor { get; set; }

        /// <summary>NHL season code, for example 20262027.</summary>
        public int NhlSeasonCode { get; set; }

        /// <summary>True when this is the current season.</summary>
        public bool IsCurrent { get; set; }
    }

    /// <summary>
    /// Minimal fantasy team information (id + name).
    /// </summary>
    public class FantasyTeamDto
    {
        /// <summary>Database id of the fantasy team.</summary>
        public int Id { get; set; }

        /// <summary>Name of the fantasy team (the DG name in this league).</summary>
        public string Name { get; set; } = string.Empty;
    }

    /// <summary>
    /// Report returned by POST /api/league/setup so you can see exactly
    /// what the setup created or updated.
    /// </summary>
    public class LeagueSetupResultDto
    {
        /// <summary>One-line summary, for example "Setup complete: 16 created, 2 updated."</summary>
        public string Summary { get; set; } = string.Empty;

        /// <summary>Human-readable lines describing everything that was created.</summary>
        public List<string> Created { get; set; } = new List<string>();

        /// <summary>Human-readable lines describing everything that was updated.</summary>
        public List<string> Updated { get; set; } = new List<string>();
    }
}
