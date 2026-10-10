namespace NhlFantasyLeague.api.Models.Dtos
{
    public class CreateTradeOfferRequest
    {
        public List<CreateTradeOfferSlotRequest> Slots { get; set; } = new();
        public string? Note { get; set; }
    }

    public class CreateTradeOfferSlotRequest
    {
        public string PositionGroup { get; set; } = string.Empty;
        public int? OfferingPlayerId { get; set; }
        public int? DemandMinContractYears { get; set; }
        public decimal? DemandMaxSalary { get; set; }
        public int? DemandMaxAge { get; set; }
        public int? DemandMinPointsLastYear { get; set; }
    }

    public class TradeOfferDto
    {
        public int Id { get; set; }
        public int CreatedByFantasyTeamId { get; set; }
        public string CreatedByFantasyTeamName { get; set; } = string.Empty;
        public DateTime CreatedAt { get; set; }
        public string? Note { get; set; }
        public string Status { get; set; } = string.Empty;
        public bool IsMine { get; set; }

        /// <summary>
        /// True when the caller has never loaded this offer in the
        /// browse tab before. Drives the green "Nouvelle offre" badge
        /// on the frontend. Always false on write responses.
        /// </summary>
        public bool IsNew { get; set; }

        public List<TradeOfferSlotDto> Slots { get; set; } = new();
    }

    public class TradeOfferSlotDto
    {
        public int SlotIndex { get; set; }
        public string PositionGroup { get; set; } = string.Empty;
        public int? OfferingPlayerId { get; set; }
        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }
        public string? OfferingPlayerPosition { get; set; }
        public PlayerContractLineDto? OfferingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? OfferingPlayerSecondContract { get; set; }
        public int? DemandMinContractYears { get; set; }
        public decimal? DemandMaxSalary { get; set; }
        public int? DemandMaxAge { get; set; }
        public int? DemandMinPointsLastYear { get; set; }
    }

    public class TradeOfferActionResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public TradeOfferDto? Offer { get; set; }

        /// <summary>
        /// Populated only by RespondToOfferAsync. Null on the offer
        /// lifecycle endpoints (create, cancel).
        /// </summary>
        public TradeOfferResponseDto? Response { get; set; }
    }

    /// <summary>
    /// Request body of POST /api/Marketplace/offers/mark-seen.
    /// </summary>
    public class MarkOffersSeenRequest
    {
        public List<int> OfferIds { get; set; } = new();
    }

    // -----------------------------------------------------------------
    // Responses to an offer ("Offres reçues" / "Offres envoyées")
    // -----------------------------------------------------------------

    /// <summary>
    /// One response to a TradeOffer. The same DTO serves both sides
    /// of the exchange:
    ///
    ///   - Received view ("Offres reçues")  — from the offer
    ///     creator's point of view. The card header shows the
    ///     RESPONDING team's name.
    ///
    ///   - Sent view ("Offres envoyées")    — from the responding
    ///     team's point of view. The card header shows the ORIGINAL
    ///     OFFER CREATOR's name.
    ///
    /// Both names are carried so the frontend can pick the right one
    /// per section without a second call.
    /// </summary>
    public class TradeOfferResponseDto
    {
        public int Id { get; set; }
        public int TradeOfferId { get; set; }

        /// <summary>Free-text note from the original offer, or null.</summary>
        public string? TradeOfferNote { get; set; }

        // --- Original offer creator ("sent" header) ---

        public int TradeOfferCreatedByFantasyTeamId { get; set; }
        public string TradeOfferCreatedByFantasyTeamName { get; set; } =
            string.Empty;

        // --- Responding team ("received" header) ---

        public int RespondingFantasyTeamId { get; set; }
        public string RespondingFantasyTeamName { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; }
        public string Status { get; set; } = string.Empty;

        public List<TradeOfferResponseSlotDto> Slots { get; set; } = new();
    }

    public class TradeOfferResponseSlotDto
    {
        public int SlotIndex { get; set; }

        /// <summary>"F", "D" or "G" — copied from the original offer slot.</summary>
        public string PositionGroup { get; set; } = string.Empty;

        // --- The player the responding team offers for this slot ---

        public int RespondingPlayerId { get; set; }
        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
        public string? RespondingPlayerPosition { get; set; }
        public PlayerContractLineDto? RespondingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? RespondingPlayerSecondContract { get; set; }

        // --- Demand filters from the original offer slot ---

        public int? DemandMinContractYears { get; set; }
        public decimal? DemandMaxSalary { get; set; }
        public int? DemandMaxAge { get; set; }
        public int? DemandMinPointsLastYear { get; set; }
    }

    /// <summary>
    /// Request body of POST /api/Marketplace/offers/{id}/respond.
    /// One pick per slot of the original offer.
    /// </summary>
    public class RespondToTradeOfferRequest
    {
        public List<RespondToTradeOfferPickDto> Picks { get; set; } = new();
    }

    public class RespondToTradeOfferPickDto
    {
        /// <summary>Must match a SlotIndex on the offer being responded to.</summary>
        public int SlotIndex { get; set; }

        /// <summary>A player on the responding manager's roster.</summary>
        public int RespondingPlayerId { get; set; }
    }
}