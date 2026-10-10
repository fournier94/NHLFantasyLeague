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

        // Draft information. All nullable: undrafted players have none of
        // these set, and old rows keep working until the next population.
        public int? DraftYear { get; set; }

        public string? DraftTeamAbbreviation { get; set; }

        public int? DraftRound { get; set; }

        public int? DraftPickInRound { get; set; }

        public int? DraftOverallPick { get; set; }

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

        public string? InjuryType { get; set; }       // "Lower Body", "Hip", "Suspension"
        public string? InjuryDetail { get; set; }      // "Surgery", "Not Specified"
        public string? InjurySide { get; set; }        // "Left", "Right", "Not Specified"
        public DateOnly? InjuryReturnDate { get; set; } // projected return
        public string? InjuryFantasyStatus { get; set; } // "OUT", "IR", "Day-To-Day"

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

        /// <summary>
        /// Where this player currently sits within his NHL club, as of
        /// the last successful PlayerRosterStatus refresh. Null when
        /// the status has never been determined (fresh install, or the
        /// feature is turned off).
        /// </summary>
        public RosterLocation? RosterLocation { get; set; }

        /// <summary>
        /// UTC timestamp of the last refresh that successfully wrote
        /// RosterLocation. Null when never set.
        /// </summary>
        public DateTime? RosterLocationUpdatedAt { get; set; }

        /// <summary>
        /// When true, the CapFreeze contract sync skips this player
        /// entirely: no page fetch, no contract write, no status
        /// change, no name/slug update. The commissioner manages
        /// this player's contracts by hand through the "Contrats
        /// manuels" admin section.
        ///
        /// Used for the two Elias Pettersson records, whose CapFreeze
        /// pages cannot be reliably told apart by the matching
        /// service. Any player whose contract is not derivable from
        /// CapFreeze can be flagged this way.
        ///
        /// Removing the flag re-enables the sync on the next run,
        /// which will overwrite the manual values.
        /// </summary>
        public bool SkipCapFreezeSync { get; set; }
    }
}