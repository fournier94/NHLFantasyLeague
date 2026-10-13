namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Per-user memory of which marketplace responses a user has
    /// already seen. One row per (UserId, TradeOfferResponseId);
    /// only its existence matters (it drives the "Nouvelle offre"
    /// badge on the Reçues panel, and the navbar notification count
    /// for unseen responses).
    ///
    /// Mirrors TradeOfferView, but keyed on the response instead of
    /// the offer. A user can have seen the original offer as its
    /// creator, and still have an unseen response to that offer.
    /// The two markers are independent.
    ///
    /// Cascade on both sides: deleting the user or the response
    /// drops its view rows too. Never read as a "seen at"
    /// timestamp — only the row's existence matters.
    /// </summary>
    public class TradeOfferResponseView
    {
        public int Id { get; set; }

        public int UserId { get; set; }
        public ApplicationUser User { get; set; } = null!;

        public int TradeOfferResponseId { get; set; }
        public TradeOfferResponse TradeOfferResponse { get; set; } = null!;

        public DateTime SeenAt { get; set; } = DateTime.UtcNow;
    }
}