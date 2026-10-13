namespace NhlFantasyLeague.api.Models.Dtos
{
    public class CreateTradeOfferRequest
    {
        public List<CreateTradeOfferSlotRequest> Slots { get; set; } = new();
        public string? Note { get; set; }

        /// <summary>
        /// Ids of the draft picks the creator's team is putting on
        /// the table. Each id must reference a DraftPick whose
        /// CurrentOwnerFantasyTeamId is the creator's team.
        /// Referenced, not transferred.
        /// </summary>
        public List<int> DraftPickIds { get; set; } = new();
    }

    public class CreateTradeOfferSlotRequest
    {
        public string PositionGroup { get; set; } = string.Empty;
        public int? OfferingPlayerId { get; set; }
        public int? DemandMinContractYears { get; set; }
        public decimal? DemandMaxSalary { get; set; }
        public int? DemandMaxAge { get; set; }
        public int? DemandMinPointsLastYear { get; set; }

        public bool EnforceDemandMinContractYears { get; set; } = true;
        public bool EnforceDemandMaxSalary { get; set; } = true;
        public bool EnforceDemandMaxAge { get; set; } = true;
        public bool EnforceDemandMinPointsLastYear { get; set; } = true;
    }

    public class TradeOfferDto
    {
        public int Id { get; set; }
        public int CreatedByFantasyTeamId { get; set; }
        public string CreatedByFantasyTeamName { get; set; } = string.Empty;

        public decimal? CreatedByFantasyTeamCapSalary { get; set; }
        public decimal SeasonSalaryCap { get; set; }

        public DateTime CreatedAt { get; set; }
        public string? Note { get; set; }
        public string Status { get; set; } = string.Empty;
        public bool IsMine { get; set; }
        public bool IsNew { get; set; }

        public List<TradeOfferSlotDto> Slots { get; set; } = new();

        /// <summary>
        /// Draft picks the offer's creator is putting on the table.
        /// </summary>
        public List<DraftPickDto> Picks { get; set; } = new();
    }

    public class TradeOfferSlotDto
    {
        public int SlotIndex { get; set; }
        public string PositionGroup { get; set; } = string.Empty;
        public int? OfferingPlayerId { get; set; }
        public int? OfferingPlayerNhlPlayerId { get; set; }
        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }
        public string? OfferingPlayerPosition { get; set; }
        public int? OfferingPlayerAge { get; set; }
        public string? OfferingPlayerRosterStatus { get; set; }

        public PlayerContractLineDto? OfferingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? OfferingPlayerSecondContract { get; set; }
        public SeasonStatLineDto? OfferingPlayerCurrentSeasonStats { get; set; }
        public SeasonStatLineDto? OfferingPlayerLastSeasonStats { get; set; }

        public int? DemandMinContractYears { get; set; }
        public decimal? DemandMaxSalary { get; set; }
        public int? DemandMaxAge { get; set; }
        public int? DemandMinPointsLastYear { get; set; }

        public bool EnforceDemandMinContractYears { get; set; } = true;
        public bool EnforceDemandMaxSalary { get; set; } = true;
        public bool EnforceDemandMaxAge { get; set; } = true;
        public bool EnforceDemandMinPointsLastYear { get; set; } = true;
    }

    public class TradeOfferActionResultDto
    {
        public bool Success { get; set; }
        public string Message { get; set; } = string.Empty;
        public TradeOfferDto? Offer { get; set; }
        public TradeOfferResponseDto? Response { get; set; }
    }

    public class MarkOffersSeenRequest
    {
        public List<int> OfferIds { get; set; } = new();
    }

    public class TradeOfferResponseDto
    {
        public int Id { get; set; }
        public int TradeOfferId { get; set; }
        public string? TradeOfferNote { get; set; }

        public int TradeOfferCreatedByFantasyTeamId { get; set; }
        public string TradeOfferCreatedByFantasyTeamName { get; set; } =
            string.Empty;
        public decimal? TradeOfferCreatedByFantasyTeamCapSalary { get; set; }

        public int RespondingFantasyTeamId { get; set; }
        public string RespondingFantasyTeamName { get; set; } = string.Empty;
        public decimal? RespondingFantasyTeamCapSalary { get; set; }

        public decimal SeasonSalaryCap { get; set; }

        public DateTime CreatedAt { get; set; }
        public string Status { get; set; } = string.Empty;

        public List<TradeOfferResponseSlotDto> Slots { get; set; } = new();

        /// <summary>
        /// Draft picks the original offer's creator is putting on
        /// the table (from TradeOffer.Picks). Rendered on the LEFT
        /// side of the response card.
        /// </summary>
        public List<DraftPickDto> CreatorPicks { get; set; } = new();

        /// <summary>
        /// Additional draft picks the RESPONDING team is requesting
        /// from the offer's creator, on top of the offer's own
        /// picks. Also rendered on the LEFT side (creator's side).
        /// </summary>
        public List<DraftPickDto> RequestedPicks { get; set; } = new();

        /// <summary>
        /// Draft picks the responding team is putting on the table.
        /// Rendered on the RIGHT side.
        /// </summary>
        public List<DraftPickDto> RespondingPicks { get; set; } = new();
    }

    public class TradeOfferResponseSlotDto
    {
        public int SlotIndex { get; set; }
        public string PositionGroup { get; set; } = string.Empty;

        public int? OfferingPlayerId { get; set; }
        public int? OfferingPlayerNhlPlayerId { get; set; }
        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }
        public string? OfferingPlayerPosition { get; set; }
        public int? OfferingPlayerAge { get; set; }
        public PlayerContractLineDto? OfferingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? OfferingPlayerSecondContract { get; set; }
        public SeasonStatLineDto? OfferingPlayerCurrentSeasonStats { get; set; }
        public SeasonStatLineDto? OfferingPlayerLastSeasonStats { get; set; }

        public int RespondingPlayerId { get; set; }
        public int? RespondingPlayerNhlPlayerId { get; set; }
        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
        public string? RespondingPlayerPosition { get; set; }
        public int? RespondingPlayerAge { get; set; }
        public PlayerContractLineDto? RespondingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? RespondingPlayerSecondContract { get; set; }
        public SeasonStatLineDto? RespondingPlayerCurrentSeasonStats { get; set; }
        public SeasonStatLineDto? RespondingPlayerLastSeasonStats { get; set; }

        public int? DemandMinContractYears { get; set; }
        public decimal? DemandMaxSalary { get; set; }
        public int? DemandMaxAge { get; set; }
        public int? DemandMinPointsLastYear { get; set; }
    }

    public class RespondToTradeOfferRequest
    {
        public List<RespondToTradeOfferPickDto> Picks { get; set; } = new();

        /// <summary>
        /// Ids of the responding team's draft picks being offered.
        /// Each id must reference a DraftPick owned by the
        /// responding team.
        /// </summary>
        public List<int> DraftPickIds { get; set; } = new();

        /// <summary>
        /// Ids of the offer CREATOR's draft picks the responding
        /// team is requesting on top of whatever the offer already
        /// carries. Each id must reference a DraftPick owned by the
        /// offer's creator.
        /// </summary>
        public List<int> RequestedDraftPickIds { get; set; } = new();
    }

    public class RespondToTradeOfferPickDto
    {
        public int SlotIndex { get; set; }
        public int RespondingPlayerId { get; set; }
    }

    public class CreateDirectOfferSlotRequest
    {
        public int ConnectedPlayerId { get; set; }
        public int TargetPlayerId { get; set; }
    }

    public class CreateDirectOfferRequest
    {
        public int TargetTeamId { get; set; }
        public List<CreateDirectOfferSlotRequest> Slots { get; set; } = new();
        public string? Note { get; set; }
        public List<int> ConnectedDraftPickIds { get; set; } = new();
        public List<int> TargetDraftPickIds { get; set; } = new();
    }

    public class AdminAcceptedTradeDto
    {
        public int ResponseId { get; set; }
        public int TradeOfferId { get; set; }

        public int OfferCreatorTeamId { get; set; }
        public string OfferCreatorTeamName { get; set; } = string.Empty;

        public int RespondingTeamId { get; set; }
        public string RespondingTeamName { get; set; } = string.Empty;

        public DateTime CreatedAt { get; set; }
        public string? Note { get; set; }

        public List<AdminAcceptedTradeSlotDto> Slots { get; set; } = new();

        /// <summary>
        /// Draft picks the offer creator is giving away (from
        /// TradeOffer.Picks).
        /// </summary>
        public List<DraftPickDto> OfferCreatorPicks { get; set; } = new();

        /// <summary>
        /// Additional draft picks the offer creator is giving away,
        /// requested by the responding team (from
        /// TradeOfferResponseRequestedPick).
        /// </summary>
        public List<DraftPickDto> RequestedPicks { get; set; } = new();

        /// <summary>
        /// Draft picks the responding team is giving away.
        /// </summary>
        public List<DraftPickDto> RespondingPicks { get; set; } = new();
    }

    public class AdminAcceptedTradeSlotDto
    {
        public int SlotIndex { get; set; }
        public string PositionGroup { get; set; } = string.Empty;

        public int? OfferingPlayerId { get; set; }
        public int? OfferingPlayerNhlPlayerId { get; set; }
        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }

        public int RespondingPlayerId { get; set; }
        public int? RespondingPlayerNhlPlayerId { get; set; }
        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
    }
}