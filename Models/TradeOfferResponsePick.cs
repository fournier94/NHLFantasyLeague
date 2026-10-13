namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One draft pick attached to a TradeOfferResponse, on the
    /// responder's "responding" side. Represents a pick that the
    /// responding team is offering as part of its answer to someone
    /// else's offer.
    ///
    /// Symmetric to <see cref="TradeOfferPick"/>: this row is a
    /// reference, not a transfer. Ownership of the DraftPick changes
    /// only when the commissioner performs the manual swap after the
    /// trade is accepted.
    ///
    /// Cascade from TradeOfferResponse: if a response is deleted, its
    /// pick rows go with it. Restrict on DraftPick for the same
    /// reason as TradeOfferPick.
    /// </summary>
    public class TradeOfferResponsePick
    {
        public int Id { get; set; }

        public int TradeOfferResponseId { get; set; }
        public TradeOfferResponse TradeOfferResponse { get; set; } = null!;

        public int DraftPickId { get; set; }
        public DraftPick DraftPick { get; set; } = null!;
    }
}