namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Broad category of an ESPN injury row, used to pick the right icon
    /// and the right label on the frontend.
    ///
    /// The raw ESPN status string stays on Player.InjuryStatus; this enum
    /// is a normalized, icon-friendly classification of it.
    /// </summary>
    public enum InjuryKind
    {
        /// <summary>Not injured, or the status could not be classified.</summary>
        None = 0,

        /// <summary>A real injury ("Out", "Day-To-Day", "Injured Reserve", ...).</summary>
        Injury = 1,

        /// <summary>A league suspension ("Suspension", "Suspended").</summary>
        Suspension = 2
    }
}