namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// A published trade offer created by a fantasy manager in the
    /// Marketplace. It contains 1..10 slots, each of which represents
    /// one (offered player, demanded position + filters) pair.
    ///
    /// In addition to the slots, an offer can carry a list of draft
    /// picks on the creator's offering side. Picks are attached at
    /// publish time and stay with the offer until it is cancelled or
    /// the underlying trade is accepted.
    ///
    /// The "positions must match on each side" rule from the league
    /// is enforced structurally for slots: a slot's OfferingPlayer
    /// (if any) always belongs to the same PositionGroup as the
    /// slot's PositionGroup.
    ///
    /// Offers are scoped to a Season. When a season ends they remain
    /// in the database for audit but the marketplace listing only
    /// shows ACTIVE offers for the current season.
    ///
    /// NOTE ON DRAFT PICKS: the picks listed here are references.
    /// No DraftPick row changes ownership when the offer is created,
    /// published, responded to, or accepted. The commissioner does
    /// the manual swap on the DraftPick row itself, matching how
    /// players are handled after an accepted trade.
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

        /// <summary>
        /// True when this TradeOffer was synthesized by the "Créer"
        /// tab's direct-offer flow, and therefore represents a
        /// PRIVATE proposal between two managers rather than a
        /// public annonce.
        ///
        /// Direct offers still need a TradeOffer row (the target
        /// manager reads it on his Reçues panel and the sender
        /// reads it on his Envoyées panel), so the row exists. But
        /// it must NEVER appear in any other manager's "Voir les
        /// offres" browse list, and it must not bump the browse
        /// notification badge for anyone.
        ///
        /// Public annonces (created by the "Publier une annonce"
        /// form) leave this false; every code path that builds a
        /// browse list or a browse-badge count filters on it.
        /// </summary>
        public bool IsDirectOffer { get; set; }

        public ICollection<TradeOfferSlot> Slots { get; set; }
            = new List<TradeOfferSlot>();

        /// <summary>
        /// Draft picks the offer's creator is putting on the table.
        /// Referenced, not transferred. See the class note.
        /// </summary>
        public ICollection<TradeOfferPick> Picks { get; set; }
            = new List<TradeOfferPick>();
    }
}