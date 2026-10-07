namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One row of a player's per-game stats on a given date, read
    /// from PlayerGameLog. Used by the "Hier" table on the
    /// Classement page, which reads frozen DB data instead of
    /// re-fetching boxscores from the NHL API for games that ended
    /// hours ago.
    ///
    /// Only players who dressed are included: a PlayerGameLog row
    /// exists only if the player appeared in the game.
    /// </summary>
    public class RosterPlayerGameStatDto
    {
        /// <summary>Database id of the player (Player.Id).</summary>
        public int PlayerId { get; set; }

        /// <summary>NHL API id (Player.NhlPlayerId).</summary>
        public int NhlPlayerId { get; set; }

        /// <summary>NHL game id of the game the player dressed for.</summary>
        public long GameId { get; set; }

        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int PlusMinus { get; set; }

        /// <summary>"MM:SS" time on ice, or null when unknown.</summary>
        public string? TimeOnIce { get; set; }

        public int Shots { get; set; }

        /// <summary>Fantasy points for this game.</summary>
        public int FantasyPoints { get; set; }
    }
}