namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// A response to a TradeOffer. Created when a manager fills in
    /// every slot of someone else's offer and clicks "Offrir".
    ///
    /// One response per (TradeOffer, RespondingFantasyTeam) while the
    /// offer is Active. The responding team must provide one player
    /// per offer slot; each player must belong to the responding
    /// team and match the slot's demanded position group.
    ///
    /// A response carries four kinds of attachments:
    ///   - Slots: the responder's players.
    ///   - Picks: the responder's own draft picks (RespondingPicks).
    ///   - RequestedPicks: additional draft picks the responder
    ///     wants the offer creator to give, on top of whatever the
    ///     offer already carries.
    ///   - RemovedPicks: draft picks the responder explicitly
    ///     removes from the offer creator's own pick list. The
    ///     final deal excludes these.
    ///
    /// All four are references, not transfers. Ownership changes
    /// only when the commissioner performs the manual swap after
    /// the offer creator accepts.
    ///
    /// Responses are what the offer creator sees in his "Offres
    /// reçues" section.
    /// </summary>
    public class TradeOfferResponse
    {
        public int Id { get; set; }

        public int TradeOfferId { get; set; }
        public TradeOffer TradeOffer { get; set; } = null!;

        public int RespondingFantasyTeamId { get; set; }
        public FantasyTeam RespondingFantasyTeam { get; set; } = null!;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public TradeOfferResponseStatus Status { get; set; } =
            TradeOfferResponseStatus.Pending;

        /// <summary>
        /// Optional free-text message from the responding manager.
        /// Shown to the offer creator on the Reçues card, and to the
        /// responder himself on the Envoyées card.
        ///
        /// A response may be sent with this Note as its only content:
        /// no players, no picks. That is deliberate — the league is
        /// a private friend group and managers sometimes want to
        /// send a message like "what would you offer for this
        /// player?" without committing to a full trade shape.
        ///
        /// Max length 1000, matching TradeOffer.Note.
        /// </summary>
        public string? Note { get; set; }

        public ICollection<TradeOfferResponseSlot> Slots { get; set; }
            = new List<TradeOfferResponseSlot>();

        /// <summary>
        /// Draft picks the responding team is putting on the table.
        /// </summary>
        public ICollection<TradeOfferResponsePick> Picks { get; set; }
            = new List<TradeOfferResponsePick>();

        /// <summary>
        /// Draft picks the responding team is REQUESTING from the
        /// offer's creator. Added to whatever the offer already
        /// carries (TradeOffer.Picks).
        /// </summary>
        public ICollection<TradeOfferResponseRequestedPick>
            RequestedPicks
        { get; set; }
            = new List<TradeOfferResponseRequestedPick>();

        /// <summary>
        /// Draft picks the responding team REMOVED from the offer's
        /// own pick list. Subtracted from whatever the offer already
        /// carries (TradeOffer.Picks). The final deal excludes
        /// these picks.
        /// </summary>
        public ICollection<TradeOfferResponseRemovedPick>
            RemovedPicks
        { get; set; }
            = new List<TradeOfferResponseRemovedPick>();
    }
}