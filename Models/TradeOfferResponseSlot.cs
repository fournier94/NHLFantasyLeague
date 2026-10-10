namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One pick inside a TradeOfferResponse: for the offer slot at
    /// SlotIndex, the responding team offers RespondingPlayerId.
    ///
    /// The position group and demand filters are NOT duplicated here;
    /// they live on the original TradeOfferSlot and are pulled from
    /// there when the response is read back.
    /// </summary>
    public class TradeOfferResponseSlot
    {
        public int Id { get; set; }

        public int TradeOfferResponseId { get; set; }
        public TradeOfferResponse TradeOfferResponse { get; set; } = null!;

        /// <summary>Matches TradeOfferSlot.SlotIndex on the original offer.</summary>
        public int SlotIndex { get; set; }

        public int RespondingPlayerId { get; set; }
        public Player RespondingPlayer { get; set; } = null!;
    }
}