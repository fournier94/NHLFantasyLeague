namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One injured or suspended player, as returned by
    /// GET /api/Injuries.
    ///
    /// Includes the fantasy context (which fantasy team currently
    /// holds him, at what roster status) so the page can group rows
    /// by "mine" vs "everyone else" without a second request.
    /// </summary>
    public class InjuryRowDto
    {
        public int PlayerId { get; set; }
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;

        public string? NhlTeamAbbreviation { get; set; }
        public string? NhlTeamName { get; set; }
        public string? HeadshotUrl { get; set; }

        public bool IsInjured { get; set; }

        /// <summary>Raw ESPN status ("Out", "Day-To-Day", "Injured Reserve", "Suspension").</summary>
        public string? InjuryStatus { get; set; }

        /// <summary>"None", "Injury" or "Suspension".</summary>
        public string InjuryKind { get; set; } = "None";

        public string? InjuryShortDescription { get; set; }
        public string? InjuryLongDescription { get; set; }

        /// <summary>"Lower Body", "Hip", "Suspension", ...</summary>
        public string? InjuryType { get; set; }

        /// <summary>"Surgery", "Not Specified", ...</summary>
        public string? InjuryDetail { get; set; }

        /// <summary>"Left", "Right", "Not Specified", ...</summary>
        public string? InjurySide { get; set; }

        public DateOnly? InjuryReturnDate { get; set; }

        /// <summary>ESPN fantasy status description ("OUT", "IR", "Day-To-Day").</summary>
        public string? InjuryFantasyStatus { get; set; }

        public DateTime? InjuryUpdatedAt { get; set; }

        // --- Fantasy context (null when the player is a free agent) ---

        public int? FantasyTeamId { get; set; }
        public string? FantasyTeamName { get; set; }
        public string? RosterStatus { get; set; }
    }
}