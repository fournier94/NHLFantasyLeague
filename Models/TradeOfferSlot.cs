namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One pair inside a TradeOffer: an optionally-offered player on
    /// the creator's side, and a demanded position on the other side.
    ///
    /// Criterias (min/max contract, salary, age, points) were removed
    /// from the marketplace: managers now negotiate freely and the
    /// website does not restrict what a responder can offer.
    /// </summary>
    public class TradeOfferSlot
    {
        public int Id { get; set; }

        public int TradeOfferId { get; set; }
        public TradeOffer TradeOffer { get; set; } = null!;

        /// <summary>0-based order of this slot inside the offer.</summary>
        public int SlotIndex { get; set; }

        /// <summary>"F", "D" or "G". Always uppercased.</summary>
        public string PositionGroup { get; set; } = string.Empty;

        /// <summary>
        /// Optional player offered by the creator. When null, the
        /// creator is only announcing that he is looking for a player
        /// of this PositionGroup.
        /// </summary>
        public int? OfferingPlayerId { get; set; }
        public Player? OfferingPlayer { get; set; }
    }
}