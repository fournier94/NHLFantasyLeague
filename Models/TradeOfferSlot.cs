namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One pair inside a TradeOffer: an optionally-offered player on
    /// the creator's side, and a demanded position + optional filter
    /// spec on the other side.
    ///
    /// The four demand filters are all optional. A null value means
    /// "no restriction on that dimension".
    /// </summary>
    public class TradeOfferSlot
    {
        public int Id { get; set; }

        public int TradeOfferId { get; set; }
        public TradeOffer TradeOffer { get; set; } = null!;

        /// <summary>0-based order of this slot inside the offer.</summary>
        public int SlotIndex { get; set; }

        /// <summary>"F", "D" or "G". Always uppercased.</summary>
        public string PositionGroup { get; set; } = string.Empty;

        /// <summary>
        /// Optional player offered by the creator. When null, the
        /// creator is only announcing that he is looking for a player
        /// of this PositionGroup that fits the filters.
        /// </summary>
        public int? OfferingPlayerId { get; set; }
        public Player? OfferingPlayer { get; set; }

        // ---- Demand filters (all optional) ----

        /// <summary>Minimum number of seasons left on the target contract.</summary>
        public int? DemandMinContractYears { get; set; }

        /// <summary>Maximum salary in dollars.</summary>
        public decimal? DemandMaxSalary { get; set; }

        /// <summary>Maximum age in years.</summary>
        public int? DemandMaxAge { get; set; }

        /// <summary>Minimum points produced last NHL season.</summary>
        public int? DemandMinPointsLastYear { get; set; }
    }
}