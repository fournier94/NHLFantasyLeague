namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Visual style the user has chosen for the PlayerPage. Persisted
    /// per user so the page loads with the same look on every visit.
    /// </summary>
    public enum PlayerPageStyle
    {
        /// <summary>
        /// Neon look: Grindy Brush player name with a team-colored
        /// aura, section titles without a red stroke, team-colored
        /// stat strip, team-colored headshot aura.
        /// </summary>
        Neon = 0,

        /// <summary>
        /// Classic look: plain white bold player name, section titles
        /// with the default red stroke + cyan aura, cyan stat strip,
        /// headshot with no aura.
        /// </summary>
        Classic = 1
    }
}