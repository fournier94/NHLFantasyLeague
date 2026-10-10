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

        /// <summary>
        /// The creator team's current cap hit: sum of the fantasy
        /// salaries of the team's Active and Bench entries for the
        /// current season. Prospects are excluded, matching the
        /// rule used by GET /api/Roster/team/{id} (CapSalary).
        ///
        /// Used by the frontend to display the creator's projected
        /// cap space under his name on the trade offer card. Null
        /// when the DTO is synthesized from a response (received /
        /// sent panels), where the responding team's or the
        /// original creator's cap is not loaded.
        /// </summary>
        public decimal? CreatedByFantasyTeamCapSalary { get; set; }

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

        /// <summary>
        /// NHL API id of the offered player. Used by the frontend to
        /// link the player's name to his detail page
        /// (/joueurs/{nhlPlayerId}). Null when the slot has no
        /// offering player.
        /// </summary>
        public int? OfferingPlayerNhlPlayerId { get; set; }

        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }
        public string? OfferingPlayerPosition { get; set; }

        /// <summary>
        /// "Active", "Bench" or "Prospect" for the offering player,
        /// as of the current season. Null when the player is no
        /// longer on the creator's roster (offer is stale) or when
        /// the slot has no offering player.
        ///
        /// Used by the frontend to exclude prospects from the
        /// projected cap-space calculation — same rule as the
        /// server-side cap that skips Prospect entries entirely.
        /// </summary>
        public string? OfferingPlayerRosterStatus { get; set; }

        public PlayerContractLineDto? OfferingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? OfferingPlayerSecondContract { get; set; }

        /// <summary>
        /// NHL regular-season stats for the offering player in the
        /// current season, or null when no PlayerSeasonStat row
        /// exists yet. Rendered by the frontend as a small stat
        /// table between the player name and his contract.
        /// </summary>
        public SeasonStatLineDto? OfferingPlayerCurrentSeasonStats { get; set; }

        /// <summary>
        /// NHL regular-season stats for the offering player in the
        /// previous season, or null when no row exists yet.
        /// </summary>
        public SeasonStatLineDto? OfferingPlayerLastSeasonStats { get; set; }

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

        /// <summary>
        /// NHL API id of the responding player. Used by the frontend
        /// to link the player's name to his detail page
        /// (/joueurs/{nhlPlayerId}).
        /// </summary>
        public int? RespondingPlayerNhlPlayerId { get; set; }

        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
        public string? RespondingPlayerPosition { get; set; }
        public PlayerContractLineDto? RespondingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? RespondingPlayerSecondContract { get; set; }

        /// <summary>
        /// NHL regular-season stats for the responding player in the
        /// current season, or null. Mirrors the offering side.
        /// </summary>
        public SeasonStatLineDto? RespondingPlayerCurrentSeasonStats { get; set; }

        /// <summary>
        /// NHL regular-season stats for the responding player in the
        /// previous season, or null.
        /// </summary>
        public SeasonStatLineDto? RespondingPlayerLastSeasonStats { get; set; }

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

    // -----------------------------------------------------------------
    // Admin: accepted trades awaiting manual player swaps
    // -----------------------------------------------------------------

    /// <summary>
    /// One accepted response, as shown in the admin page's "Trades en
    /// attentes" section. Carries both sides of the exchange so the
    /// commissioner can perform the manual roster moves without
    /// opening any other screen.
    /// </summary>
    public class AdminAcceptedTradeDto
    {
        /// <summary>TradeOfferResponse.Id. Used by the delete endpoint.</summary>
        public int ResponseId { get; set; }

        public int TradeOfferId { get; set; }

        public int OfferCreatorTeamId { get; set; }
        public string OfferCreatorTeamName { get; set; } = string.Empty;

        public int RespondingTeamId { get; set; }
        public string RespondingTeamName { get; set; } = string.Empty;

        /// <summary>UTC instant the response was recorded.</summary>
        public DateTime CreatedAt { get; set; }

        public string? Note { get; set; }

        public List<AdminAcceptedTradeSlotDto> Slots { get; set; } = new();
    }

    /// <summary>
    /// One slot of an accepted trade. Both sides are included so the
    /// commissioner knows which pair of players to move.
    /// </summary>
    public class AdminAcceptedTradeSlotDto
    {
        public int SlotIndex { get; set; }

        /// <summary>"F", "D" or "G".</summary>
        public string PositionGroup { get; set; } = string.Empty;

        // --- Side offered by the original offer creator ---

        public int? OfferingPlayerId { get; set; }
        public int? OfferingPlayerNhlPlayerId { get; set; }
        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }

        // --- Side offered by the responding team ---

        public int RespondingPlayerId { get; set; }
        public int? RespondingPlayerNhlPlayerId { get; set; }
        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
    }
}