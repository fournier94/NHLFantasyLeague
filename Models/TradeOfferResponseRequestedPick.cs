namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One draft pick the RESPONDING team is requesting from the
    /// offer's creator, attached to a TradeOfferResponse.
    ///
    /// These are ADDED to whatever the creator already offered on
    /// the original TradeOffer (TradeOfferPick). They are not
    /// duplicates: a pick can be requested even when the creator
    /// did not originally offer it.
    ///
    /// Cascade from TradeOfferResponse: if a response is deleted,
    /// its requested pick rows go with it. Restrict on DraftPick for
    /// the same reason as TradeOfferPick.
    ///
    /// Referenced, not transferred: ownership of the DraftPick
    /// changes only when the commissioner performs the manual swap
    /// after the offer creator accepts.
    /// </summary>
    public class TradeOfferResponseRequestedPick
    {
        public int Id { get; set; }

        public int TradeOfferResponseId { get; set; }
        public TradeOfferResponse TradeOfferResponse { get; set; } = null!;

        public int DraftPickId { get; set; }
        public DraftPick DraftPick { get; set; } = null!;
    }
}