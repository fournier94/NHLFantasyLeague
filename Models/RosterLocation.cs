namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Where a player currently sits within his NHL club's organization,
    /// as computed by the PlayerRosterStatusService.
    ///
    /// This is related to but distinct from Player.IsInjured. A player
    /// can be on the NHL roster and still carry a day-to-day injury
    /// flag; the frontend decides which combination to display.
    /// </summary>
    public enum RosterLocation
    {
        /// <summary>
        /// Never determined. The player has not been scanned by the
        /// roster-status service yet, or the service is disabled.
        /// </summary>
        Unknown = 0,

        /// <summary>
        /// On the NHL club's active roster.
        /// </summary>
        NhlRoster = 1,

        /// <summary>
        /// On the NHL club's AHL affiliate roster (sent down).
        /// </summary>
        AhlRoster = 2,

        /// <summary>
        /// Reported injured by ESPN and not currently on any NHL or AHL
        /// active roster. Also covers the case where ESPN reports a
        /// day-to-day injury while the player is still on the NHL
        /// roster (the nuanced clearing rule keeps the injury flag).
        /// </summary>
        Injured = 3,

        /// <summary>
        /// On neither the NHL nor the AHL roster, and not reported
        /// injured by ESPN. Typically a free agent, a long-term
        /// injury-reserve player who has fallen off both roster
        /// endpoints, or a player the NHL API simply does not list.
        /// </summary>
        NotOnActiveRoster = 4
    }
}