namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Append-only log of every roster status a player has held on a
    /// fantasy team, with the exact UTC instant each one became effective.
    ///
    /// The current status of a player on a team is the row with the
    /// latest EffectiveAt for that (PlayerId, SeasonId). The scoring
    /// recompute walks this table to figure out, at the moment of each
    /// NHL game, which fantasy team owned the player and what his status
    /// was.
    ///
    /// Rows are never edited or deleted. To correct a mistake, insert a
    /// new row with a later EffectiveAt.
    ///
    /// A trade writes two rows for the same player at the same instant:
    /// one against the old team, one against the new team. That way
    /// "who owned him at time T" is always answerable with a single
    /// lookup, without special-casing trades.
    /// </summary>
    public class RosterStatusHistory
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }
        public Player Player { get; set; } = null!;

        public int FantasyTeamId { get; set; }
        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int SeasonId { get; set; }
        public Season Season { get; set; } = null!;

        public RosterStatus RosterStatus { get; set; }

        /// <summary>
        /// UTC instant this status became effective. The row applies
        /// from this instant until the next row for the same
        /// (PlayerId, SeasonId) supersedes it.
        /// </summary>
        public DateTime EffectiveAt { get; set; }

        /// <summary>UTC instant the row was written. Audit only.</summary>
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>
        /// Free-text note, e.g. "Active &lt;-&gt; Bench swap with X",
        /// "traded from Mathieu". Purely informational.
        /// </summary>
        public string? Note { get; set; }

        /// <summary>
        /// When non-null, this row was created by a recorded trade
        /// (see FinalizeTradeAsync) and is owned by that TradeHistory
        /// record. Used to identify exactly which history rows to move
        /// when the trade's effective date is corrected later.
        ///
        /// Rows without this value come from every other path
        /// (assign, swap, set-status, release, manual history edits,
        /// auto-backfill) and are never touched by trade date changes.
        /// </summary>
        public int? TradeHistoryId { get; set; }
        public TradeHistory? TradeHistory { get; set; }

        /// <summary>
        /// When non-null, this row was created by a recorded batch
        /// status change (see FinalizeStatusChangeAsync) and is owned
        /// by that StatusChangeHistory record. Used to identify exactly
        /// which history rows to move when the status change's
        /// effective date is corrected, or to delete on revert.
        /// </summary>
        public int? StatusChangeHistoryId { get; set; }
        public StatusChangeHistory? StatusChangeHistory { get; set; }
    }
}