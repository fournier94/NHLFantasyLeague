namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Request body for POST /api/Roster/assign: puts a player on a fantasy team.
    /// </summary>
    public class AssignPlayerRequest
    {
        /// <summary>Fantasy team that receives the player.</summary>
        public int FantasyTeamId { get; set; }

        /// <summary>Player to assign (Player.Id, not the NHL player id).</summary>
        public int PlayerId { get; set; }

        /// <summary>Season id. Optional: the current season is used when omitted.</summary>
        public int? SeasonId { get; set; }

        /// <summary>Roster status: "Active", "Bench" or "Prospect". Defaults to "Active".</summary>
        public string? RosterStatus { get; set; }

        /// <summary>Ignored: the fantasy salary is always derived from the player's PlayerContracts. Kept for backward compatibility.</summary>
        public decimal? FantasySalary { get; set; }

        /// <summary>Lineup slot number. Defaults to 0.</summary>
        public int? RosterSlot { get; set; }
    }

    /// <summary>
    /// Request body for POST /api/Roster/move: transfers a player from his
    /// current fantasy team to another team in the same season.
    /// </summary>
    public class MovePlayerRequest
    {
        /// <summary>Player to move (Player.Id).</summary>
        public int PlayerId { get; set; }

        /// <summary>Fantasy team that receives the player.</summary>
        public int NewFantasyTeamId { get; set; }

        /// <summary>Season id. Optional: the current season is used when omitted.</summary>
        public int? SeasonId { get; set; }
    }

    /// <summary>
    /// Request body for POST /api/Roster/release: removes a roster entry.
    /// </summary>
    public class ReleasePlayerRequest
    {
        /// <summary>Roster entry id (RosterEntry.Id shown in the team roster).</summary>
        public int RosterEntryId { get; set; }
    }

    /// <summary>
    /// Request body for POST /api/Roster/release-all: releases every player
    /// currently assigned to a fantasy team (full league reset).
    /// </summary>
    public class ReleaseAllPlayersRequest
    {
        /// <summary>Season id. Optional: the current season is used when omitted.</summary>
        public int? SeasonId { get; set; }
    }

    /// <summary>
    /// Request body for POST /api/Roster/update: changes the status, the
    /// fantasy team or the slot of an existing roster entry. The fantasy
    /// salary is always derived from the player's PlayerContracts.
    /// </summary>
    public class UpdateRosterEntryRequest
    {
        /// <summary>Roster entry id (RosterEntry.Id shown in the team roster).</summary>
        public int RosterEntryId { get; set; }

        /// <summary>New roster status: "Active", "Bench" or "Prospect". Optional.</summary>
        public string? RosterStatus { get; set; }

        /// <summary>When provided, transfers the player to this fantasy team. Ignored when null.</summary>
        public int? FantasyTeamId { get; set; }

        /// <summary>Ignored: the fantasy salary is always derived from the player's PlayerContracts and is recomputed on every update. Kept for backward compatibility.</summary>
        public decimal? FantasySalary { get; set; }

        /// <summary>New lineup slot number. Optional.</summary>
        public int? RosterSlot { get; set; }
    }

    /// <summary>
    /// One player on a fantasy team's roster.
    /// </summary>
    public class RosterEntryDto
    {
        /// <summary>Database id of the roster entry.</summary>
        public int Id { get; set; }

        /// <summary>Fantasy team the player belongs to.</summary>
        public int FantasyTeamId { get; set; }

        /// <summary>Database id of the player (Player.Id).</summary>
        public int PlayerId { get; set; }

        /// <summary>NHL player id (NHL API id).</summary>
        public int NhlPlayerId { get; set; }

        /// <summary>Player first name.</summary>
        public string FirstName { get; set; } = string.Empty;

        /// <summary>Player last name.</summary>
        public string LastName { get; set; } = string.Empty;

        /// <summary>Player position (C, LW, RW, D or G).</summary>
        public string Position { get; set; } = string.Empty;

        /// <summary>NHL team abbreviation of the player, for example "MTL".</summary>
        public string NhlTeamAbbreviation { get; set; } = string.Empty;

        /// <summary>Roster status: "Active", "Bench" or "Prospect".</summary>
        public string RosterStatus { get; set; } = string.Empty;

        /// <summary>Lineup slot number.</summary>
        public int RosterSlot { get; set; }

        /// <summary>Fantasy salary used for the cap, in dollars.</summary>
        public decimal FantasySalary { get; set; }

        /// <summary>Player headshot photo url, or null when unavailable.</summary>
        public string? HeadshotUrl { get; set; }

        /// <summary>Previous season stat line (2025-26), or null when unavailable.</summary>
        public SeasonStatLineDto? LastSeason { get; set; }

        /// <summary>Current season stat line (2026-27), or null when unavailable.</summary>
        public SeasonStatLineDto? CurrentSeason { get; set; }
    }

    /// <summary>
    /// One season of NHL statistics shown on a player card. Skater fields and
    /// goalie fields are both present; the frontend displays the ones matching
    /// the player's position.
    /// </summary>
    public class SeasonStatLineDto
    {
        /// <summary>Season name for display, for example "2025-26".</summary>
        public string Label { get; set; } = string.Empty;

        /// <summary>NHL season code, for example 20252026.</summary>
        public int NhlSeasonCode { get; set; }

        /// <summary>Games played (skaters and goalies).</summary>
        public int GamesPlayed { get; set; }

        /// <summary>Goals scored (skaters).</summary>
        public int Goals { get; set; }

        /// <summary>Assists (skaters).</summary>
        public int Assists { get; set; }

        /// <summary>Points (skaters).</summary>
        public int Points { get; set; }

        /// <summary>Wins (goalies).</summary>
        public int Wins { get; set; }

        /// <summary>Losses (goalies).</summary>
        public int Losses { get; set; }

        /// <summary>Overtime losses (goalies). The modern NHL has no ties.</summary>
        public int OvertimeLosses { get; set; }
    }

    /// <summary>
    /// Full roster of one fantasy team for one season, with totals.
    /// </summary>
    public class TeamRosterDto
    {
        /// <summary>Database id of the fantasy team.</summary>
        public int FantasyTeamId { get; set; }

        /// <summary>Name of the fantasy team.</summary>
        public string FantasyTeamName { get; set; } = string.Empty;

        /// <summary>Database id of the season.</summary>
        public int SeasonId { get; set; }

        /// <summary>Name of the season, for example "2026-2027".</summary>
        public string SeasonName { get; set; } = string.Empty;

        /// <summary>Number of players on the roster.</summary>
        public int TotalPlayers { get; set; }

        /// <summary>Number of players with status "Active".</summary>
        public int ActiveCount { get; set; }

        /// <summary>Number of players with status "Bench".</summary>
        public int BenchCount { get; set; }

        /// <summary>Number of players with status "Prospect".</summary>
        public int ProspectCount { get; set; }

        /// <summary>Sum of the fantasy salaries of the roster, in dollars.</summary>
        public decimal TotalSalary { get; set; }

        /// <summary>The roster entries, ordered by status, then slot, then last name.</summary>
        public List<RosterEntryDto> Entries { get; set; } = new List<RosterEntryDto>();
    }

    /// <summary>
    /// Result of an assign, move, release or update operation.
    /// </summary>
    public class RosterActionResultDto
    {
        /// <summary>True when the operation succeeded.</summary>
        public bool Success { get; set; }

        /// <summary>Human-readable message describing what happened, or why it failed.</summary>
        public string Message { get; set; } = string.Empty;

        /// <summary>The roster entry after the operation, or null after a release.</summary>
        public RosterEntryDto? Entry { get; set; }
    }

    /// <summary>
    /// One player returned by the player search.
    /// </summary>
    public class PlayerSearchResultDto
    {
        /// <summary>Database id of the player (Player.Id).</summary>
        public int PlayerId { get; set; }

        /// <summary>NHL player id (NHL API id).</summary>
        public int NhlPlayerId { get; set; }

        /// <summary>Player first name.</summary>
        public string FirstName { get; set; } = string.Empty;

        /// <summary>Player last name.</summary>
        public string LastName { get; set; } = string.Empty;

        /// <summary>Player position (C, LW, RW, D or G).</summary>
        public string Position { get; set; } = string.Empty;

        /// <summary>NHL team abbreviation of the player, for example "MTL".</summary>
        public string NhlTeamAbbreviation { get; set; } = string.Empty;

        /// <summary>Fantasy team currently holding the player, or null when free.</summary>
        public int? FantasyTeamId { get; set; }

        /// <summary>Name of the fantasy team currently holding the player, or null when free.</summary>
        public string? FantasyTeamName { get; set; }

        /// <summary>Roster entry id for the current season, or null when the player is a free agent.</summary>
        public int? RosterEntryId { get; set; }

        /// <summary>Roster status for the current season ("Active", "Bench" or "Prospect"), or null when the player is a free agent.</summary>
        public string? RosterStatus { get; set; }
    }
}
