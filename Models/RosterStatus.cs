namespace NhlFantasyLeague.api.Models
{
    public enum RosterStatus
    {
        Active,
        Bench,
        Prospect,

        /// <summary>
        /// Terminal status used in RosterStatusHistory when a player
        /// is released. Not a valid value for an active RosterEntry;
        /// it exists only so the scoring recompute can tell that a
        /// released player must not be credited to his old team.
        /// </summary>
        Released
    }
}