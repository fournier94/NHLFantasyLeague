using System.ComponentModel.DataAnnotations.Schema;

namespace NhlFantasyLeague.api.Models
{
    public class Player
    {
        public int Id { get; set; }

        public int NhlPlayerId { get; set; }

        public string FirstName { get; set; } = string.Empty;

        public string LastName { get; set; } = string.Empty;

        public string? CapFreezeName { get; set; }

        public string? CapFreezeSlug { get; set; }

        public string Position { get; set; } = string.Empty;

        public int? NhlTeamId { get; set; }

        public int? PreviousNhlTeamId { get; set; }

        [ForeignKey(nameof(NhlTeamId))]
        public NhlTeam? NhlTeam { get; set; }

        public DateOnly? BirthDate { get; set; }

        public string? BirthCity { get; set; }

        public string? BirthCountry { get; set; }

        public int? HeightInInches { get; set; }

        public int? WeightInPounds { get; set; }

        public string? ShootsCatches { get; set; }

        public string? HeadshotUrl { get; set; }

        public string? HeroImageUrl { get; set; }

        /// <summary>
        /// True when ESPN currently lists this player as injured or
        /// suspended. Cleared on every successful refresh, then re-set
        /// for the players ESPN still reports.
        /// </summary>
        public bool IsInjured { get; set; }

        /// <summary>
        /// Raw ESPN status string ("Out", "Day-To-Day", "Injured Reserve",
        /// "Suspension"), or null when not injured.
        /// </summary>
        public string? InjuryStatus { get; set; }

        /// <summary>
        /// Normalized classification of InjuryStatus, used by the frontend
        /// to pick between the injury icon and the suspension icon.
        /// </summary>
        public InjuryKind InjuryKind { get; set; } = InjuryKind.None;

        /// <summary>
        /// Short one-line note from ESPN, used almost everywhere.
        /// </summary>
        public string? InjuryShortDescription { get; set; }

        /// <summary>
        /// Long analyst note from ESPN, used on the injuries page and the
        /// player page only.
        /// </summary>
        public string? InjuryLongDescription { get; set; }

        /// <summary>
        /// UTC timestamp of the last refresh that touched this player's
        /// injury fields, whether it set them or cleared them.
        /// </summary>
        public DateTime? InjuryUpdatedAt { get; set; }

        public PlayerStatus Status { get; set; } = PlayerStatus.Unsigned;

        public ICollection<PlayerContract> Contracts { get; set; }
            = new List<PlayerContract>();

        public DateTime? CapFreezeStatusLastUpdated { get; set; }

        public DateTime? CapFreezeContractLastUpdated { get; set; }
    }
}