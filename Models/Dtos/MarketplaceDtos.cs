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

        /// <summary>
        /// Per-criterion strict flags. A criterion is only enforced
        /// as a hard filter on the responder's dropdown when its
        /// flag is true AND the corresponding demand value is set.
        /// A criterion set but not strict is a preference.
        ///
        /// Position is always enforced regardless.
        ///
        /// Each flag defaults to true when omitted from the JSON
        /// body, so an old client that does not send them keeps the
        /// strict behavior.
        /// </summary>
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

        /// <summary>
        /// The creator team's current cap hit: sum of the fantasy
        /// salaries of the team's Active and Bench entries for the
        /// current season. Prospects are excluded, matching the
        /// rule used by GET /api/Roster/team/{id} (CapSalary).
        ///
        /// Used by the frontend together with <see cref="SeasonSalaryCap"/>
        /// to compute the creator's space under cap on the trade
        /// offer card. Null when the DTO is synthesized from a
        /// response (received / sent panels), where the responding
        /// team's or the original creator's cap is not loaded.
        /// </summary>
        public decimal? CreatedByFantasyTeamCapSalary { get; set; }

        /// <summary>
        /// Salary cap for the season this offer belongs to, in
        /// dollars. Same value for both teams on the card since
        /// they play in the same league and season. Used by the
        /// frontend with the per-team cap hit to display each
        /// side's space under cap on the offer card.
        /// </summary>
        public decimal SeasonSalaryCap { get; set; }

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
        /// Age in years, computed from the player's BirthDate. Null
        /// when the birth date is unknown. Displayed next to the
        /// player's name on the offer card.
        /// </summary>
        public int? OfferingPlayerAge { get; set; }

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

        /// <summary>
        /// Per-criterion strict flags. A criterion is enforced as a
        /// hard filter on the responder's dropdown only when its
        /// flag is true AND the corresponding demand value is set.
        /// A criterion set but not strict is a preference.
        /// Position is always enforced regardless.
        /// </summary>
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
    ///     creator's point of view.
    ///
    ///   - Sent view ("Offres envoyées")    — from the responding
    ///     team's point of view.
    ///
    /// Both team names are carried so the frontend can render the
    /// two header columns and the two slot columns consistently:
    ///
    ///   - LEFT column: the original offer creator and the player
    ///     he offered.
    ///   - RIGHT column: the responding team and the player he
    ///     offered in return.
    ///
    /// This is the same layout in both views, so a response card
    /// looks identical whichever side is looking at it.
    /// </summary>
    public class TradeOfferResponseDto
    {
        public int Id { get; set; }
        public int TradeOfferId { get; set; }

        /// <summary>Free-text note from the original offer, or null.</summary>
        public string? TradeOfferNote { get; set; }

        // --- Original offer creator (left header column) ---

        public int TradeOfferCreatedByFantasyTeamId { get; set; }
        public string TradeOfferCreatedByFantasyTeamName { get; set; } =
            string.Empty;

        /// <summary>
        /// Original offer creator's cap hit for the season the
        /// response was made in. Null when cap info was not loaded
        /// (e.g. the offer's season could not be resolved). Used
        /// by the frontend together with SeasonSalaryCap to
        /// display the creator's space under cap on the response
        /// card.
        /// </summary>
        public decimal? TradeOfferCreatedByFantasyTeamCapSalary { get; set; }

        // --- Responding team (right header column) ---

        public int RespondingFantasyTeamId { get; set; }
        public string RespondingFantasyTeamName { get; set; } = string.Empty;

        /// <summary>
        /// Responding team's cap hit for the season the response
        /// was made in. Null when cap info was not loaded. Used by
        /// the frontend together with SeasonSalaryCap to display
        /// the responder's space under cap on the response card.
        /// </summary>
        public decimal? RespondingFantasyTeamCapSalary { get; set; }

        /// <summary>
        /// Salary cap for the season this response belongs to, in
        /// dollars. Same value for both teams. Used by the frontend
        /// with the per-team cap hit to display each side's space
        /// under cap.
        /// </summary>
        public decimal SeasonSalaryCap { get; set; }

        public DateTime CreatedAt { get; set; }
        public string Status { get; set; } = string.Empty;

        public List<TradeOfferResponseSlotDto> Slots { get; set; } = new();
    }

    /// <summary>
    /// One slot of a response. Carries BOTH sides of that slot so a
    /// response card can render the offer creator's offering player
    /// on the left and the responding player on the right, without
    /// fetching the original offer separately.
    /// </summary>
    public class TradeOfferResponseSlotDto
    {
        public int SlotIndex { get; set; }

        /// <summary>"F", "D" or "G" — copied from the original offer slot.</summary>
        public string PositionGroup { get; set; } = string.Empty;

        // --- LEFT: the offering player on the original offer ---

        public int? OfferingPlayerId { get; set; }
        public int? OfferingPlayerNhlPlayerId { get; set; }
        public string? OfferingPlayerFirstName { get; set; }
        public string? OfferingPlayerLastName { get; set; }
        public string? OfferingPlayerNhlTeam { get; set; }
        public string? OfferingPlayerPosition { get; set; }

        /// <summary>Age in years of the offering player, or null.</summary>
        public int? OfferingPlayerAge { get; set; }

        public PlayerContractLineDto? OfferingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? OfferingPlayerSecondContract { get; set; }
        public SeasonStatLineDto? OfferingPlayerCurrentSeasonStats { get; set; }
        public SeasonStatLineDto? OfferingPlayerLastSeasonStats { get; set; }

        // --- RIGHT: the player the responding team offers ---

        public int RespondingPlayerId { get; set; }
        public int? RespondingPlayerNhlPlayerId { get; set; }
        public string? RespondingPlayerFirstName { get; set; }
        public string? RespondingPlayerLastName { get; set; }
        public string? RespondingPlayerNhlTeam { get; set; }
        public string? RespondingPlayerPosition { get; set; }

        /// <summary>Age in years of the responding player, or null.</summary>
        public int? RespondingPlayerAge { get; set; }

        public PlayerContractLineDto? RespondingPlayerCurrentContract { get; set; }
        public PlayerContractLineDto? RespondingPlayerSecondContract { get; set; }
        public SeasonStatLineDto? RespondingPlayerCurrentSeasonStats { get; set; }
        public SeasonStatLineDto? RespondingPlayerLastSeasonStats { get; set; }

        // --- Demand filters from the original offer slot (kept for reference) ---

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