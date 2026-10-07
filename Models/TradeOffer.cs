namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// A published trade offer created by a fantasy manager in the
    /// Marketplace. It contains 1..10 slots, each of which represents
    /// one (offered player, demanded position + filters) pair.
    ///
    /// The "positions must match on each side" rule from the league is
    /// enforced structurally: a slot's OfferingPlayer (if any) always
    /// belongs to the same PositionGroup as the slot's PositionGroup.
    ///
    /// Offers are scoped to a Season. When a season ends they remain in
    /// the database for audit but the marketplace listing only shows
    /// ACTIVE offers for the current season.
    /// </summary>
    public class TradeOffer
    {
        public int Id { get; set; }

        public int CreatedByFantasyTeamId { get; set; }
        public FantasyTeam CreatedByFantasyTeam { get; set; } = null!;

        public int SeasonId { get; set; }
        public Season Season { get; set; } = null!;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        /// <summary>Optional free-text message from the creator.</summary>
        public string? Note { get; set; }

        public TradeOfferStatus Status { get; set; } = TradeOfferStatus.Active;

        public ICollection<TradeOfferSlot> Slots { get; set; }
            = new List<TradeOfferSlot>();
    }
}