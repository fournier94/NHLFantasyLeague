using System.ComponentModel.DataAnnotations.Schema;

namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Permanent audit record of one commissioner-executed trade.
    ///
    /// The trade's content is frozen in <see cref="SnapshotJson"/> at
    /// the instant the admin confirmed it. That JSON is the
    /// authoritative source for "what exactly was traded, from whom,
    /// to whom, at what date". It survives renames, retirements,
    /// and contract changes forever: the snapshot stores player
    /// names, positions, NHL teams, salaries and contract lengths
    /// as they were at trade time.
    ///
    /// This record must never be deleted. If the DB is ever lost,
    /// the admin reads these rows to reconstruct every trade the
    /// league has ever made.
    /// </summary>
    public class TradeHistory
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }
        public Season Season { get; set; } = null!;

        public int TeamAId { get; set; }
        public FantasyTeam TeamA { get; set; } = null!;

        public int TeamBId { get; set; }
        public FantasyTeam TeamB { get; set; } = null!;

        /// <summary>
        /// UTC instant (day precision) the traded players' status
        /// changes take effect on. Same value that was written into
        /// RosterStatusHistory.EffectiveAt for each moved player.
        /// </summary>
        public DateTime EffectiveAt { get; set; }

        /// <summary>UTC instant the commissioner clicked the final Confirmer.</summary>
        public DateTime ConfirmedAt { get; set; }

        /// <summary>Optional free-text note from the commissioner.</summary>
        public string? Note { get; set; }

        /// <summary>
        /// JSON snapshot of the trade (see TradeSnapshotPayload in
        /// AdminTradeDtos). Stored as PostgreSQL jsonb so the row is
        /// queryable and human-readable in the DB.
        /// </summary>
        [Column(TypeName = "jsonb")]
        public string SnapshotJson { get; set; } = string.Empty;

        /// <summary>
        /// Audit trail of every date change made on this trade, newest
        /// last. Empty for trades that were never re-dated.
        /// </summary>
        public ICollection<TradeDateChange> DateChanges { get; set; }
            = new List<TradeDateChange>();
    }
}