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
    }

    /// <summary>
    /// Request body of POST /api/Marketplace/offers/mark-seen.
    /// </summary>
    public class MarkOffersSeenRequest
    {
        public List<int> OfferIds { get; set; } = new();
    }
}