namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One pick inside a TradeOfferResponse: for the offer slot at
    /// SlotIndex, the responding team offers RespondingPlayerId.
    ///
    /// The position group is not duplicated here; it lives on the
    /// original TradeOfferSlot and is pulled from there when the
    /// response is read back.
    ///
    /// RespondingPlayerId is nullable to support unbalanced direct
    /// offers. When the target gives more players than the connected
    /// user, some offer slots have no corresponding responding
    /// player. Those rows still exist (one per offer slot, so the
    /// slot mapping stays 1:1), but they carry a null
    /// RespondingPlayerId. Public marketplace responses always fill
    /// every slot; only direct offers can produce null here.
    ///
    /// OfferingPlayerOverrideId lets the responder REPLACE the
    /// player the offer's creator put on the offering side of the
    /// slot, or ADD a player there when the creator did not offer
    /// one. When null, the offer slot's own OfferingPlayerId is
    /// used. When set, its player takes precedence on the response
    /// DTO's offering side.
    ///
    /// RemoveOfferingPlayer lets the responder EXPLICITLY empty the
    /// offering side of the slot: "I don't want any of the creator's
    /// players on this slot". When true, the response DTO's offering
    /// side is empty regardless of what the offer slot's own
    /// OfferingPlayerId holds, and OfferingPlayerOverrideId must be
    /// null.
    /// </summary>
    public class TradeOfferResponseSlot
    {
        public int Id { get; set; }

        public int TradeOfferResponseId { get; set; }
        public TradeOfferResponse TradeOfferResponse { get; set; } = null!;

        /// <summary>Matches TradeOfferSlot.SlotIndex on the original offer.</summary>
        public int SlotIndex { get; set; }

        /// <summary>
        /// The responding player for this slot, or null when the
        /// responding team did not give a player for it. Only valid
        /// on unbalanced direct offers.
        /// </summary>
        public int? RespondingPlayerId { get; set; }

        public Player? RespondingPlayer { get; set; }

        /// <summary>
        /// Optional player on the OFFERING side of this slot, chosen
        /// by the responder to replace what the offer's creator put
        /// there (or to add a player when the creator left the
        /// offering side empty).
        ///
        /// Referenced, not transferred. Ownership changes only when
        /// the commissioner performs the manual swap after the trade
        /// is accepted.
        /// </summary>
        public int? OfferingPlayerOverrideId { get; set; }

        public Player? OfferingPlayerOverride { get; set; }

        /// <summary>
        /// When true, the offering side of this slot is EXPLICITLY
        /// empty on the response: the responder does not want any of
        /// the offer creator's players on this slot, even if the
        /// creator offered one.
        ///
        /// Takes precedence over both OfferingPlayerOverrideId and
        /// the offer slot's own OfferingPlayerId. When true,
        /// OfferingPlayerOverrideId must be null.
        ///
        /// Default false so existing rows behave exactly as before
        /// (fall through to the offer slot's own offering player).
        /// </summary>
        public bool RemoveOfferingPlayer { get; set; }
    }
}