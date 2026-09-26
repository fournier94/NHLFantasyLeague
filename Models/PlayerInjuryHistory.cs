namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// One row per continuous injury spell for a player.
    ///
    /// A "spell" is (PlayerId, InjuryStatus, TeamAbbreviation) staying
    /// the same across refreshes. When that triple changes or the player
    /// is no longer reported as injured, we set ResolvedAt on the open
    /// row and open a new one on the next injury.
    /// </summary>
    public class PlayerInjuryHistory
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        /// <summary>ESPN injury status when the spell started.</summary>
        public string InjuryStatus { get; set; } = string.Empty;

        /// <summary>ESPN free-text note when the spell started.</summary>
        public string? InjuryDescription { get; set; }

        /// <summary>NHL team abbreviation reported by ESPN when the spell started.</summary>
        public string TeamAbbreviation { get; set; } = string.Empty;

        /// <summary>UTC timestamp of the first refresh that saw this spell.</summary>
        public DateTime FirstSeenAt { get; set; }

        /// <summary>UTC timestamp of the last refresh that saw this spell.</summary>
        public DateTime LastSeenAt { get; set; }

        /// <summary>
        /// UTC timestamp when the spell ended (player returned, or the
        /// status changed), or null while the spell is still ongoing.
        /// </summary>
        public DateTime? ResolvedAt { get; set; }
    }
}