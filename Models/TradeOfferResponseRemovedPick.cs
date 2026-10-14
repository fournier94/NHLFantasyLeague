namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One draft pick the RESPONDING team explicitly removed from
    /// the offer's own pick list, attached to a TradeOfferResponse.
    ///
    /// Semantics: the offer's creator put this pick on the table
    /// (TradeOfferPick). The responder's answer says "not in the
    /// trade" — the final deal excludes it. Symmetric to
    /// TradeOfferResponseRequestedPick, but subtracting instead of
    /// adding.
    ///
    /// A pick can only be removed if it is already one of the
    /// offer's own picks; the service rejects anything else.
    ///
    /// Cascade from TradeOfferResponse: if a response is deleted,
    /// its removed-pick rows go with it. Restrict on DraftPick for
    /// the same reason as the other pick-join tables.
    ///
    /// Referenced, not transferred: ownership of the DraftPick
    /// changes only when the commissioner performs the manual swap
    /// after the offer creator accepts.
    /// </summary>
    public class TradeOfferResponseRemovedPick
    {
        public int Id { get; set; }

        public int TradeOfferResponseId { get; set; }
        public TradeOfferResponse TradeOfferResponse { get; set; } = null!;

        public int DraftPickId { get; set; }
        public DraftPick DraftPick { get; set; } = null!;
    }
}