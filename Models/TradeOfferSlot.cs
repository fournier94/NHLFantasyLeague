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

        // -------------------------------------------------------------
        // Per-criterion strict flags.
        //
        // A criterion is only enforced as a hard filter on the
        // responder's dropdown when BOTH its flag is true AND the
        // corresponding demand value is set (non-null). A criterion
        // set but not strict is displayed to the responder as a
        // preference but does not filter his dropdown.
        //
        // Position is always enforced regardless of these flags — it
        // is what defines the slot.
        //
        // Every flag defaults to true, preserving the
        // strict-by-default behavior every offer had before this
        // granularity was introduced.
        // -------------------------------------------------------------

        public bool EnforceDemandMinContractYears { get; set; } = true;

        public bool EnforceDemandMaxSalary { get; set; } = true;

        public bool EnforceDemandMaxAge { get; set; } = true;

        public bool EnforceDemandMinPointsLastYear { get; set; } = true;
    }
}