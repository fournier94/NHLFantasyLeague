namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One row of the season standings, as returned by
    /// GET /api/Standings.
    ///
    /// Skater columns aggregate the team's Active-at-game-time skaters
    /// (including any player whose position could not be classified).
    /// Goalie columns aggregate the team's Active-at-game-time goalies.
    /// TotalFantasyPoints is the sum of both segments plus any bonus
    /// points the league rules add (hat trick, win, OTL, shutout),
    /// already computed by the recompute.
    /// </summary>
    public class StandingsRowDto
    {
        /// <summary>1-based rank, sorted by TotalFantasyPoints descending.</summary>
        public int Rank { get; set; }

        public int FantasyTeamId { get; set; }
        public string FantasyTeamName { get; set; } = string.Empty;

        // Skater segment
        public int SkaterGamesPlayed { get; set; }
        public int SkaterGoals { get; set; }
        public int SkaterAssists { get; set; }
        public int SkaterPoints { get; set; }
        public int SkaterHatTricks { get; set; }

        // Goalie segment
        public int GoalieGamesPlayed { get; set; }
        public int GoalieWins { get; set; }
        public int GoalieLosses { get; set; }
        public int GoalieOvertimeLosses { get; set; }
        public int GoalieShutouts { get; set; }
        public int GoaliePoints { get; set; }

        // Overall
        public int TotalFantasyPoints { get; set; }

        /// <summary>UTC timestamp of the last recompute, or null when never computed.</summary>
        public DateTime? TotalFantasyPointsComputedAt { get; set; }
    }
}