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
    /// The three FP columns below (ForwardFantasyPoints,
    /// DefenseFantasyPoints, GoalieFantasyPoints) are the same total
    /// sliced by the position group of the credited player at the
    /// moment of each game. They always sum to TotalFantasyPoints.
    /// Both writers (the live persist and the season recompute)
    /// preserve that invariant, and both the live persist and the
    /// recompute verify it and log a Warning in SystemEventLogs if
    /// it ever fails.
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

        // Skater segment (raw NHL stats, NOT fantasy points)
        public int SkaterGamesPlayed { get; set; }
        public int SkaterGoals { get; set; }
        public int SkaterAssists { get; set; }
        public int SkaterPoints { get; set; }
        public int SkaterHatTricks { get; set; }

        // Goalie segment (raw NHL stats, NOT fantasy points)
        public int GoalieGamesPlayed { get; set; }
        public int GoalieWins { get; set; }
        public int GoalieLosses { get; set; }
        public int GoalieOvertimeLosses { get; set; }
        public int GoalieShutouts { get; set; }
        public int GoaliePoints { get; set; }

        // -----------------------------------------------------------------
        // Fantasy points, split by the position group of the credited
        // player at the moment of the game.
        //
        // A player who was Active on this team for part of the season
        // and then traded away keeps contributing to THIS team's
        // Forward / Defense / Goalie columns for the games he played
        // here, because both writers walk RosterStatusHistory and
        // credit each game to whoever held the player Active at the
        // moment of that game. The three columns follow the same rule
        // as TotalFantasyPoints.
        //
        // Unknown positions are classified as forwards, matching the
        // frontend default, so Forward + Defense + Goalie always
        // equals TotalFantasyPoints.
        // -----------------------------------------------------------------

        /// <summary>
        /// FP credited to this team from games where the Active player
        /// was a forward (or had an unclassifiable position).
        /// </summary>
        public int ForwardFantasyPoints { get; set; }

        /// <summary>
        /// FP credited to this team from games where the Active player
        /// was a defenseman.
        /// </summary>
        public int DefenseFantasyPoints { get; set; }

        /// <summary>
        /// FP credited to this team from games where the Active player
        /// was a goalie.
        /// </summary>
        public int GoalieFantasyPoints { get; set; }

        // Overall
        /// <summary>
        /// FP credited to this team from games that started yesterday
        /// (real ET calendar day). Zero when the team scored nothing
        /// or had no active players in any game that day.
        /// </summary>
        public int YesterdayFantasyPoints { get; set; }

        /// <summary>
        /// FP credited to this team from games that started today
        /// (real ET calendar day). Zero when no games have started yet
        /// or the team scored nothing.
        /// </summary>
        public int TodayFantasyPoints { get; set; }

        public int TotalFantasyPoints { get; set; }

        /// <summary>UTC timestamp of the last recompute, or null when never computed.</summary>
        public DateTime? TotalFantasyPointsComputedAt { get; set; }
    }
}