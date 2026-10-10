using System.ComponentModel.DataAnnotations.Schema;

namespace NhlFantasyLeague.api.Models
{
    public class PlayerContract
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int StartSeason { get; set; }

        public int EndSeason { get; set; }

        public decimal Salary { get; set; }

        /// <summary>
        /// Manually-locked salary for this specific contract. When
        /// non-null, the CapFreeze sync still runs normally — it
        /// updates StartSeason / EndSeason, adds or removes contract
        /// rows as the player signs new deals — but the Salary on
        /// THIS row is forced to the value stored here instead of
        /// CapFreeze's value.
        ///
        /// Used for contracts with salary retention: CapFreeze shows
        /// the post-retention amount (what the current team actually
        /// pays), but for the fantasy league we want the player's
        /// full contract value.
        ///
        /// The protection travels with the row. When the contract
        /// ends and CapFreeze returns a new deal, this row is deleted
        /// as stale by SyncPlayerContractsAsync, and the protection
        /// disappears with it. No cleanup job, no season checks.
        /// </summary>
        public decimal? ProtectedSalary { get; set; }

        /// <summary>
        /// Optional free-text reason the commissioner can attach.
        /// E.g. "25% retained by previous team; CapFreeze shows 7.5M".
        /// Max length 500.
        /// </summary>
        public string? ProtectionNote { get; set; }

        /// <summary>
        /// The salary the fantasy league should use for display, cap
        /// calculation, future-season projections, and every other
        /// consumer.
        ///
        /// Returns the commissioner-locked ProtectedSalary when set,
        /// otherwise CapFreeze's raw Salary. Every read path must use
        /// this property and NOT the raw Salary column, so that
        /// setting a ProtectedSalary via the admin page becomes
        /// visible everywhere (Mon équipe, PlayerPage, marketplace,
        /// cap projections) the instant the admin saves it, without
        /// waiting for the next CapFreeze sync.
        ///
        /// Not mapped by EF Core: this is a derived value computed
        /// from two mapped columns.
        /// </summary>
        [NotMapped]
        public decimal EffectiveSalary => ProtectedSalary ?? Salary;
    }
}