namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Append-only audit log of every effective-date change made on a
    /// StatusChangeHistory record. Mirrors TradeDateChange exactly.
    ///
    /// The FIRST row's PreviousEffectiveAt is the originally-recorded
    /// date. Never deleted.
    /// </summary>
    public class StatusChangeDateChange
    {
        public int Id { get; set; }

        public int StatusChangeHistoryId { get; set; }
        public StatusChangeHistory StatusChangeHistory { get; set; } = null!;

        public DateTime PreviousEffectiveAt { get; set; }
        public DateTime NewEffectiveAt { get; set; }
        public DateTime ChangedAt { get; set; }
        public string? Reason { get; set; }
    }
}