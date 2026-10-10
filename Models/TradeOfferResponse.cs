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

        public ICollection<TradeOfferResponseSlot> Slots { get; set; }
            = new List<TradeOfferResponseSlot>();
    }
}