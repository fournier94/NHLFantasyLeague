using System.ComponentModel.DataAnnotations;

namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Request body for POST /api/Roster/swap-status: atomically swaps
    /// the RosterStatus of two players on the same fantasy team, at the
    /// same effective instant.
    ///
    /// Every legitimate roster move in the league is a same-position
    /// swap (Active &lt;-&gt; Bench, Active &lt;-&gt; Prospect, Bench
    /// &lt;-&gt; Prospect) because the shape 12/6/1 + 4/2/1 + 3 must
    /// always hold. Trades go through the existing trade flow, not
    /// through this endpoint.
    /// </summary>
    public class SwapRosterStatusRequest
    {
        /// <summary>Fantasy team the swap happens on. Must match both players' current team.</summary>
        [Required]
        public int FantasyTeamId { get; set; }

        /// <summary>Player moving OUT of his current status.</summary>
        [Required]
        public int PlayerAId { get; set; }

        /// <summary>Player moving OUT of his current status (the other side of the swap).</summary>
        [Required]
        public int PlayerBId { get; set; }

        /// <summary>Season id. Optional: the current season is used when omitted.</summary>
        public int? SeasonId { get; set; }

        /// <summary>UTC instant the swap becomes effective.</summary>
        [Required]
        public DateTime EffectiveAt { get; set; }

        /// <summary>Optional free-text note stored on both history rows.</summary>
        public string? Note { get; set; }
    }

    /// <summary>
    /// Request body for POST /api/Roster/set-status: changes a single
    /// player's RosterStatus without swapping. Escape hatch for the
    /// cases where a swap is not applicable (trades done manually,
    /// backfilling history). In normal operation the admin UI always
    /// goes through the swap endpoint.
    /// </summary>
    public class SetRosterStatusRequest
    {
        [Required]
        public int FantasyTeamId { get; set; }

        [Required]
        public int PlayerId { get; set; }

        [Required]
        public string NewRosterStatus { get; set; } = string.Empty;

        public int? SeasonId { get; set; }

        [Required]
        public DateTime EffectiveAt { get; set; }

        public string? Note { get; set; }
    }

    /// <summary>
    /// Request body for POST /api/Roster/backfill-status-history: one-time
    /// seed that writes a history row per current RosterEntry, so existing
    /// rosters have a baseline before any real swap happens.
    /// </summary>
    public class BackfillStatusHistoryRequest
    {
        public int? SeasonId { get; set; }

        /// <summary>
        /// UTC instant the seeded rows become effective. Typically the
        /// season start (2026-10-01T00:00:00Z).
        /// </summary>
        [Required]
        public DateTime EffectiveAt { get; set; }
    }

    /// <summary>
    /// One row of a player's status history, returned by the audit
    /// endpoint.
    /// </summary>
    public class RosterStatusHistoryDto
    {
        public int Id { get; set; }
        public int PlayerId { get; set; }
        public string PlayerFirstName { get; set; } = string.Empty;
        public string PlayerLastName { get; set; } = string.Empty;
        public int FantasyTeamId { get; set; }
        public string FantasyTeamName { get; set; } = string.Empty;
        public int SeasonId { get; set; }
        public string RosterStatus { get; set; } = string.Empty;
        public DateTime EffectiveAt { get; set; }
        public DateTime CreatedAt { get; set; }
        public string? Note { get; set; }
    }

    /// <summary>
    /// Request body for PATCH /api/Roster/status-history/{id}: corrects
    /// the EffectiveAt of a history row in place.
    ///
    /// If another row for the same player and season shares the exact
    /// same EffectiveAt (which happens on every trade: the outgoing and
    /// incoming rows are written at the same instant), both rows are
    /// moved together so the pair stays a pair.
    /// </summary>
    public class UpdateRosterStatusHistoryRequest
    {
        /// <summary>
        /// New effective instant. Required. Normalized to day precision
        /// (00:00 UTC of the same day) before it is written.
        /// </summary>
        [Required]
        public DateTime EffectiveAt { get; set; }

        /// <summary>
        /// Optional free-text note that replaces the existing note on
        /// the row(s). Null leaves the existing note alone.
        /// </summary>
        public string? Note { get; set; }
    }
}