namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One draft pick attached to a TradeOffer, on the offer creator's
    /// "offering" side. Represents a pick that the creator's team is
    /// offering as part of the trade.
    ///
    /// The pick is only referenced here — this row does NOT move
    /// ownership of the DraftPick. When both sides accept a trade,
    /// the commissioner performs the manual swap on the DraftPick
    /// row itself (updating CurrentOwnerFantasyTeamId) exactly as he
    /// does for players. This table exists only so the offer and its
    /// responses can display the picks.
    ///
    /// Cascade from TradeOffer: if an offer is deleted, its pick rows
    /// go with it. Restrict on DraftPick: a DraftPick that has ever
    /// been referenced by an offer cannot be deleted.
    /// </summary>
    public class TradeOfferPick
    {
        public int Id { get; set; }

        public int TradeOfferId { get; set; }
        public TradeOffer TradeOffer { get; set; } = null!;

        public int DraftPickId { get; set; }
        public DraftPick DraftPick { get; set; } = null!;
    }
}