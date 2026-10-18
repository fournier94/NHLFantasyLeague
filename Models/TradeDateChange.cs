namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row per date change on a TradeHistory record. Append-only
    /// audit log: every time the commissioner changes the effective
    /// date of a trade, a new row is inserted here so the full
    /// progression of dates is preserved.
    ///
    /// Example: a trade was recorded on 2026-10-01, then changed to
    /// 2026-10-03, then to 2026-10-02. The TradeHistory row shows
    /// EffectiveAt = 2026-10-02, and three TradeDateChange rows
    /// describe the two transitions. The first value (2026-10-01)
    /// lives on the FIRST TradeDateChange row's PreviousEffectiveAt,
    /// so the original date is always recoverable.
    ///
    /// Never deleted.
    /// </summary>
    public class TradeDateChange
    {
        public int Id { get; set; }

        public int TradeHistoryId { get; set; }
        public TradeHistory TradeHistory { get; set; } = null!;

        /// <summary>UTC instant (day precision) the trade was effective at before this change.</summary>
        public DateTime PreviousEffectiveAt { get; set; }

        /// <summary>UTC instant (day precision) the trade is effective at after this change.</summary>
        public DateTime NewEffectiveAt { get; set; }

        /// <summary>UTC instant the commissioner made the change.</summary>
        public DateTime ChangedAt { get; set; }

        /// <summary>Optional free-text reason. Max length 500.</summary>
        public string? Reason { get; set; }
    }
}