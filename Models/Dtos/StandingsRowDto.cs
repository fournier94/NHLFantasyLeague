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
    ///
    /// YesterdayFantasyPoints and TodayFantasyPoints are computed on
    /// the fly from PlayerGameLog + RosterStatusHistory. They show
    /// what the team's Active-at-game-time players produced in the
    /// games that started yesterday / today. They are NOT part of the
    /// season total.
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
        /// <summary>
        /// FP credited to this team from games that started yesterday
        /// (UTC calendar day). Zero when the team scored nothing or
        /// had no active players in any game that day.
        /// </summary>
        public int YesterdayFantasyPoints { get; set; }

        /// <summary>
        /// FP credited to this team from games that started today
        /// (UTC calendar day). Zero when no games have started yet or
        /// the team scored nothing.
        /// </summary>
        public int TodayFantasyPoints { get; set; }

        public int TotalFantasyPoints { get; set; }

        /// <summary>UTC timestamp of the last recompute, or null when never computed.</summary>
        public DateTime? TotalFantasyPointsComputedAt { get; set; }
    }
}