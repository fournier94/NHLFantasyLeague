namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Per-user memory of which marketplace offers a user has already
    /// seen. One row per (UserId, TradeOfferId).
    ///
    /// When a user hits GET /api/Marketplace/offers, the service:
    ///   1. reads the user's existing view rows to figure out which
    ///      offers are new to him,
    ///   2. sets IsNew = true on each DTO where no view row exists,
    ///   3. inserts the missing view rows so the same offers are no
    ///      longer considered new on the next call.
    ///
    /// Rows are never read as a "seen at" timestamp anywhere — only
    /// their existence matters. SeenAt is kept for potential audit /
    /// cleanup jobs.
    /// </summary>
    public class TradeOfferView
    {
        public int Id { get; set; }

        public int UserId { get; set; }
        public ApplicationUser User { get; set; } = null!;

        public int TradeOfferId { get; set; }
        public TradeOffer TradeOffer { get; set; } = null!;

        public DateTime SeenAt { get; set; } = DateTime.UtcNow;
    }
}