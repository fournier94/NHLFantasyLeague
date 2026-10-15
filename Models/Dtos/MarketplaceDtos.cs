namespace NhlFantasyLeague.api.Models.Dtos
{
    public class CreateTradeOfferRequest
    {
        public List<CreateTradeOfferSlotRequest> Slots { get; set; } = new();
        public string? Note { get; set; }

        public List<int> DraftPickIds { get; set; } = new();
    }

    public class CreateTradeOfferSlotRequest
    {
        public string PositionGroup { get; set; } = string.Empty;
        public int? OfferingPlayerId { get; set; }
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

    public class MarkResponsesSeenRequest
    {
        public List<int> ResponseIds { get; set; } = new();
    }

    public class MarketplaceNotificationCountDto
    {
        /// <summary>
        /// Green count: active browse offers the user has never
        /// seen. Because modifying an offer deletes the other
        /// users' "seen" markers, a modified offer is counted here
        /// again on its next browse, which is exactly the "new or
        /// modified offer in Voir les offres" signal.
        /// </summary>
        public int UnseenOffers { get; set; }

        /// <summary>
        /// Gold count, part 1: pending responses on the user's own
        /// offers that he has not yet opened the Reçues tab on.
        /// </summary>
        public int UnseenResponses { get; set; }

        /// <summary>
        /// Gold count, part 2: responses the user sent to someone
        /// else's offer that have since been accepted, and which he
        /// has not yet opened the Envoyées tab on.
        /// </summary>
        public int UnseenAcceptedSentResponses { get; set; }

        /// <summary>
        /// Persistent count for the "Reçues" segmented button label.
        ///
        /// Total number of rows the Reçues panel renders for the
        /// user: every Pending or Accepted response on one of his
        /// own still-active offers. This is the same set that
        /// ListReceivedResponsesAsync returns, so the label always
        /// matches what the user would see if he opened the tab.
        ///
        /// Unlike UnseenResponses, this count is NOT reduced when
        /// the user marks responses as seen. The navbar badge still
        /// drops on visit (it reads the unseen fields); the button
        /// label stays at the true section count.
        /// </summary>
        public int TotalReceivedResponses { get; set; }

        /// <summary>
        /// Persistent count for the "Envoyées" segmented button
        /// label.
        ///
        /// Total number of rows the Envoyées panel renders for the
        /// user: every Pending or Accepted response his team has
        /// sent to someone else's still-active offer. Symmetric to
        /// TotalReceivedResponses: same persistence rule, same
        /// "matches what the panel shows" definition.
        /// </summary>
        public int TotalSentResponses { get; set; }

        /// <summary>
        /// Combined unseen count. This is what the navbar badge
        /// renders. Deliberately does NOT include the two totals
        /// above: those are section-scoped persistent counters,
        /// not "new for you" signals.
        /// </summary>
        public int Total { get; set; }
    }

    public class TradeOfferResponseDto
    {
        public int Id { get; set; }
        public int TradeOfferId { get; set; }
        public string? TradeOfferNote { get; set; }

        /// <summary>
        /// Optional free-text message from the responding manager.
        /// Distinct from TradeOfferNote, which is the message the
        /// offer's creator wrote when he published the offer.
        /// </summary>
        public string? Note { get; set; }

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

        public bool IsNew { get; set; }

        public List<TradeOfferResponseSlotDto> Slots { get; set; } = new();

        public List<DraftPickDto> CreatorPicks { get; set; } = new();

        public List<DraftPickDto> RequestedPicks { get; set; } = new();

        public List<DraftPickDto> RespondingPicks { get; set; } = new();

        /// <summary>
        /// Draft picks the responding team removed from the offer
        /// creator's own pick list. The final deal excludes these.
        /// </summary>
        public List<DraftPickDto> RemovedCreatorPicks { get; set; } = new();
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

        /// <summary>
        /// True when the responder explicitly emptied the offering
        /// side of this slot. When true, all OfferingPlayer* fields
        /// are null by design; the flag distinguishes "the responder
        /// cleared the creator's player" from "the creator never
        /// offered anyone on this slot".
        /// </summary>
        public bool RemoveOfferingPlayer { get; set; }

        public int? RespondingPlayerId { get; set; }
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
    }

    public class RespondToTradeOfferRequest
    {
        public List<RespondToTradeOfferPickDto> Picks { get; set; } = new();

        /// <summary>
        /// Optional free-text message from the responding manager.
        /// A response may be sent with this Note as its only content
        /// (no players, no picks), so managers can send a message
        /// like "what would you offer for this player?" without
        /// committing to a full trade shape.
        /// </summary>
        public string? Note { get; set; }

        public List<int> DraftPickIds { get; set; } = new();

        public List<int> RequestedDraftPickIds { get; set; } = new();

        /// <summary>
        /// Draft picks the responding team is REMOVING from the
        /// offer's own pick list. Each id must reference a pick
        /// already offered on the original TradeOffer.
        /// </summary>
        public List<int> RemovedCreatorDraftPickIds { get; set; } = new();
    }

    public class RespondToTradeOfferPickDto
    {
        public int SlotIndex { get; set; }

        /// <summary>
        /// The responding player for this slot. Null is allowed on
        /// unbalanced direct offers where the responder did not give
        /// a player for one of the target's slots.
        /// </summary>
        public int? RespondingPlayerId { get; set; }

        /// <summary>
        /// Optional player on the OFFERING side of this slot, chosen
        /// by the responder to replace the offer creator's own
        /// choice, or to add a player where the creator left the
        /// offering side empty. Null leaves the offer creator's
        /// player (if any) in place.
        /// </summary>
        public int? OfferingPlayerOverrideId { get; set; }

        /// <summary>
        /// When true, the responder explicitly empties the offering
        /// side of this slot: the offer creator's own player is
        /// ignored and the response says "leave this slot empty on
        /// the offering side". Mutually exclusive with
        /// OfferingPlayerOverrideId: when this is true, that must be
        /// null.
        /// </summary>
        public bool RemoveOfferingPlayer { get; set; }
    }

    public class CreateDirectOfferSlotRequest
    {
        public int? ConnectedPlayerId { get; set; }
        public int? TargetPlayerId { get; set; }
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

        public List<DraftPickDto> OfferCreatorPicks { get; set; } = new();
        public List<DraftPickDto> RequestedPicks { get; set; } = new();
        public List<DraftPickDto> RespondingPicks { get; set; } = new();

        /// <summary>
        /// Draft picks the responding team removed from the offer
        /// creator's own pick list. Already excluded from
        /// OfferCreatorPicks on the response shape; kept here so the
        /// admin can see what was removed.
        /// </summary>
        public List<DraftPickDto> RemovedCreatorPicks { get; set; } = new();
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

        public int? RespondingPlayerId { get; set; }
        public int? RespondingPlayerNhlPlayerId { get; set; }
        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
    }
}