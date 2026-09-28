namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Everything the player detail page needs, in one payload.
    /// </summary>
    public class PlayerDetailDto
    {
        // --- Identity ---------------------------------------------------
        public int PlayerId { get; set; }
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;
        public string? ShootsCatches { get; set; }
        public string? HeadshotUrl { get; set; }
        public string? HeroImageUrl { get; set; }

        /// <summary>Current NHL team abbreviation, e.g. "CHI".</summary>
        public string? NhlTeamAbbreviation { get; set; }

        /// <summary>Current NHL team full name, e.g. "Chicago Blackhawks".</summary>
        public string? NhlTeamName { get; set; }

        /// <summary>Current NHL team logo url, or null.</summary>
        public string? NhlTeamLogoUrl { get; set; }

        /// <summary>Previous NHL team abbreviation, or null.</summary>
        public string? PreviousNhlTeamAbbreviation { get; set; }

        /// <summary>Previous NHL team full name, or null.</summary>
        public string? PreviousNhlTeamName { get; set; }

        /// <summary>Player status: "Unsigned", "Rostered", "FarmPlayer", "RFA".</summary>
        public string Status { get; set; } = string.Empty;

        // --- Bio --------------------------------------------------------
        public DateOnly? BirthDate { get; set; }
        public int? Age { get; set; }
        public string? BirthCity { get; set; }
        public string? BirthCountry { get; set; }

        public int? HeightInInches { get; set; }
        public int? HeightInCentimeters { get; set; }
        public int? WeightInPounds { get; set; }
        public int? WeightInKilograms { get; set; }

        // --- Draft ------------------------------------------------------
        public int? DraftYear { get; set; }
        public string? DraftTeamAbbreviation { get; set; }
        public int? DraftRound { get; set; }
        public int? DraftPickInRound { get; set; }
        public int? DraftOverallPick { get; set; }

        // --- Injury -----------------------------------------------------
        public bool IsInjured { get; set; }
        public string? InjuryStatus { get; set; }
        public string? InjuryKind { get; set; }
        public string? InjuryShortDescription { get; set; }
        public string? InjuryLongDescription { get; set; }
        public DateTime? InjuryUpdatedAt { get; set; }
        public List<InjuryHistoryDto> InjuryHistory { get; set; } = new();

        // --- Contracts --------------------------------------------------
        public List<ContractDto> Contracts { get; set; } = new();

        /// <summary>
        /// Current-season cap hit derived from the contract covering the
        /// current season, or null when no contract covers it.
        /// </summary>
        public decimal? CurrentCapHit { get; set; }

        // --- Fantasy context --------------------------------------------
        public int? FantasyTeamId { get; set; }
        public string? FantasyTeamName { get; set; }
        public string? RosterStatus { get; set; }
        public int? RosterSlot { get; set; }
        public decimal? FantasySalary { get; set; }

        /// <summary>Fantasy points scored this season, or null when not computed yet.</summary>
        public int? SeasonFantasyPoints { get; set; }

        /// <summary>Number of hat-tricks scored this season, or null when not computed yet.</summary>
        public int? SeasonHatTricks { get; set; }

        /// <summary>
        /// Regular-season totals for the current season, used by the
        /// two-row fantasy stat table on the player page. Null when no
        /// PlayerSeasonStat row exists yet for the current season.
        /// </summary>
        public CurrentSeasonStatsDto? CurrentSeasonStats { get; set; }

        // --- Career stats -----------------------------------------------
        public List<CareerRowDto> RegularSeason { get; set; } = new();
        public List<CareerRowDto> Playoffs { get; set; } = new();
        public CareerTotalsDto NhlTotals { get; set; } = new();
        public List<CareerRowDto> Tournaments { get; set; } = new();

        /// <summary>
        /// Youth / minor-development rows (CSSHL, WSI, Brick
        /// Invitational, J18/J20 Region, etc.). Kept separate from the
        /// main career table so the professional and major-junior
        /// seasons are not drowned out by pre-junior seasons.
        /// </summary>
        public List<CareerRowDto> YouthMinor { get; set; } = new();

        // --- Game log ---------------------------------------------------
        /// <summary>
        /// Last N games the player played, most recent first. Loaded
        /// from PlayerGameLog, capped at 10 rows.
        /// </summary>
        public List<GameLogRowDto> RecentGames { get; set; } = new();

        /// <summary>
        /// Four rows, one per calendar quarter of the regular season.
        /// The quarter boundaries are computed from the earliest and
        /// latest regular-season game dates across the whole league.
        /// Quarters with no games are still returned, with zeros.
        /// </summary>
        public List<QuarterDto> SeasonQuarters { get; set; } = new();
    }

    /// <summary>
    /// One row of the career table. Carries both skater and goalie
    /// fields; the frontend picks which columns to display based on the
    /// player's position.
    /// </summary>
    public class CareerRowDto
    {
        public int Season { get; set; }
        public string SeasonLabel { get; set; } = string.Empty;
        public string LeagueAbbreviation { get; set; } = string.Empty;
        public string? TeamName { get; set; }
        public int GameTypeId { get; set; }

        // Skater fields
        public int GamesPlayed { get; set; }
        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int PenaltyMinutes { get; set; }
        public int PlusMinus { get; set; }
        public int PowerPlayGoals { get; set; }
        public int PowerPlayPoints { get; set; }
        public int ShorthandedGoals { get; set; }
        public int ShorthandedPoints { get; set; }
        public int GameWinningGoals { get; set; }
        public int OvertimeGoals { get; set; }
        public int Shots { get; set; }
        public decimal ShootingPercentage { get; set; }
        public string? AverageTimeOnIce { get; set; }
        public decimal? FaceoffWinningPercentage { get; set; }

        // Goalie fields
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int OvertimeLosses { get; set; }
        public int Shutouts { get; set; }
        public int Saves { get; set; }
        public int ShotsAgainst { get; set; }
        public decimal SavePercentage { get; set; }
        public int GoalsAgainst { get; set; }
        public decimal GoalsAgainstAverage { get; set; }
    }

    /// <summary>
    /// Sums of every NHL regular-season row for the player, used by the
    /// "NHL Totals" line at the bottom of the career table.
    /// </summary>
    public class CareerTotalsDto
    {
        public int GamesPlayed { get; set; }
        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int PenaltyMinutes { get; set; }
        public int PlusMinus { get; set; }
        public int PowerPlayPoints { get; set; }
        public int Shots { get; set; }
        public int GameWinningGoals { get; set; }

        public int PlayoffGamesPlayed { get; set; }
        public int PlayoffGoals { get; set; }
        public int PlayoffAssists { get; set; }
        public int PlayoffPoints { get; set; }
        public int PlayoffPenaltyMinutes { get; set; }
        public int PlayoffPowerPlayPoints { get; set; }
        public int PlayoffShots { get; set; }
        public int PlayoffGameWinningGoals { get; set; }

        public int Wins { get; set; }
        public int Losses { get; set; }
        public int OvertimeLosses { get; set; }
        public int Shutouts { get; set; }
        public int Saves { get; set; }
        public int ShotsAgainst { get; set; }
        public int GoalsAgainst { get; set; }

        /// <summary>
        /// Save percentage across all NHL regular-season games, computed
        /// as Saves / ShotsAgainst. Zero when ShotsAgainst is zero.
        /// </summary>
        public decimal SavePercentage { get; set; }

        public int PlayoffWins { get; set; }
        public int PlayoffLosses { get; set; }
        public int PlayoffOvertimeLosses { get; set; }
        public int PlayoffShutouts { get; set; }
    }

    /// <summary>
    /// Aggregated stats for one quarter of the regular season. Carries
    /// both skater and goalie fields; the frontend picks which to show.
    /// </summary>
    public class QuarterDto
    {
        /// <summary>"Q1" / "Q2" / "Q3" / "Q4".</summary>
        public string Label { get; set; } = string.Empty;

        /// <summary>First day of the quarter.</summary>
        public DateOnly StartDate { get; set; }

        /// <summary>Last day of the quarter (inclusive).</summary>
        public DateOnly EndDate { get; set; }

        /// <summary>Games the player played in this quarter.</summary>
        public int GamesPlayed { get; set; }

        // Skater fields
        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int PenaltyMinutes { get; set; }
        public int PlusMinus { get; set; }
        public int Shots { get; set; }

        // Goalie fields
        public int Wins { get; set; }
        public int Losses { get; set; }
        public int OvertimeLosses { get; set; }
        public int Shutouts { get; set; }
        public int Saves { get; set; }
        /// <summary>
        /// Save percentage across all NHL regular-season games, computed
        /// as Saves / ShotsAgainst. Zero when ShotsAgainst is zero.
        /// </summary>
        public decimal SavePercentage { get; set; }
        public int ShotsAgainst { get; set; }
        public int GoalsAgainst { get; set; }

        /// <summary>Fantasy points scored in this quarter.</summary>
        public int FantasyPoints { get; set; }
    }

    /// <summary>
    /// One open or resolved injury spell for the player.
    /// </summary>
    public class InjuryHistoryDto
    {
        public string InjuryStatus { get; set; } = string.Empty;
        public string? InjuryDescription { get; set; }
        public string TeamAbbreviation { get; set; } = string.Empty;
        public DateTime FirstSeenAt { get; set; }
        public DateTime LastSeenAt { get; set; }
        public DateTime? ResolvedAt { get; set; }
    }

    /// <summary>
    /// One contract of the player, as raw as it appears in the DB.
    /// </summary>
    public class ContractDto
    {
        public decimal Salary { get; set; }
        public int StartSeason { get; set; }
        public int EndSeason { get; set; }
        public int YearsRemaining { get; set; }
    }

    /// <summary>
    /// Current-season regular-season totals for the player, sourced from
    /// PlayerSeasonStat. Used by the fantasy stat table on the player page.
    /// </summary>
    public class CurrentSeasonStatsDto
    {
        public int GamesPlayed { get; set; }
        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int HatTricks { get; set; }
        public int FantasyPoints { get; set; }
    }

    /// <summary>
    /// One game from the player's recent game log.
    /// </summary>
    public class GameLogRowDto
    {
        public long NhlGameId { get; set; }
        public DateOnly GameDate { get; set; }
        public string OpponentAbbreviation { get; set; } = string.Empty;
        public bool IsHomeGame { get; set; }
        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int PenaltyMinutes { get; set; }
        public int PlusMinus { get; set; }
        public int Shots { get; set; }
        public int FantasyPoints { get; set; }

        // Goalie-specific
        public bool GoalieWin { get; set; }
        public bool GoalieOvertimeLoss { get; set; }
        public bool Shutout { get; set; }
        public int GoalsAgainst { get; set; }
        public int ShotsAgainst { get; set; }
        public int Saves { get; set; }
    }
}