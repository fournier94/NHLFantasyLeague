namespace NhlFantasyLeague.api.Models
{
    public class FantasyTeamSeason
    {
        public int Id { get; set; }

        public int FantasyTeamId { get; set; }
        public FantasyTeam FantasyTeam { get; set; } = null!;

        public int SeasonId { get; set; }
        public Season Season { get; set; } = null!;

        public bool IsActive { get; set; }

        /// <summary>
        /// Total fantasy points credited to this fantasy team for the
        /// season. Only counts points a player produced while his
        /// RosterStatus was Active on this team, sliced at the exact
        /// instant of each NHL game.
        ///
        /// This is the number used for the season standings.
        ///
        /// Always equals ForwardFantasyPoints + DefenseFantasyPoints
        /// + GoalieFantasyPoints. Both writers are expected to
        /// preserve this invariant; the season recompute checks it
        /// and logs a Warning to SystemEventLogs if it ever fails.
        /// </summary>
        public int TotalFantasyPoints { get; set; }

        /// <summary>
        /// UTC timestamp of the last successful recompute. Null when
        /// the totals have never been computed for this team and season.
        /// </summary>
        public DateTime? TotalFantasyPointsComputedAt { get; set; }

        // -----------------------------------------------------------------
        // Fantasy points, split by the position group of the credited
        // player at the moment of the game.
        //
        // A player who was Active on this team for part of the season
        // and then traded away keeps contributing to THIS team's
        // columns for the games he played here, because the season
        // recompute walks RosterStatusHistory and credits each game to
        // whoever held the player Active at the moment of that game.
        // The three columns below follow the exact same history rule.
        //
        // Unknown positions are classified as forwards, matching the
        // frontend's default, so the sum is always exact.
        // -----------------------------------------------------------------

        /// <summary>
        /// Fantasy points credited to this team from games where the
        /// Active player was classified as a forward (or had an
        /// unclassifiable position).
        /// </summary>
        public int ForwardFantasyPoints { get; set; }

        /// <summary>
        /// Fantasy points credited to this team from games where the
        /// Active player was classified as a defenseman.
        /// </summary>
        public int DefenseFantasyPoints { get; set; }

        /// <summary>
        /// Fantasy points credited to this team from games where the
        /// Active player was classified as a goalie.
        /// </summary>
        public int GoalieFantasyPoints { get; set; }

        // -----------------------------------------------------------------
        // Skater aggregates (Active-at-game-time skaters only).
        //
        // "Skater" = Forward, Defense, or Unknown position. Unknown is
        // treated as a skater on purpose: it keeps the totals consistent
        // even when a position has not been set yet.
        //
        // These columns are RAW NHL stats (goals, assists, points),
        // not fantasy points. They are not split by position group;
        // only the FP columns above are.
        // -----------------------------------------------------------------

        public int SkaterGamesPlayed { get; set; }
        public int SkaterGoals { get; set; }
        public int SkaterAssists { get; set; }
        public int SkaterPoints { get; set; }
        public int SkaterHatTricks { get; set; }

        // -----------------------------------------------------------------
        // Goalie aggregates (Active-at-game-time goalies only).
        //
        // Same note as the skater columns: these are RAW stats, not FP.
        // -----------------------------------------------------------------

        public int GoalieGamesPlayed { get; set; }
        public int GoalieWins { get; set; }
        public int GoalieLosses { get; set; }
        public int GoalieOvertimeLosses { get; set; }
        public int GoalieShutouts { get; set; }

        /// <summary>
        /// Goals + assists recorded by Active-at-game-time goalies. Rare
        /// but possible (a goalie can be credited with an assist, and
        /// very occasionally a goal). Counts toward PTS on the standings
        /// page so the column adds up cleanly with FP.
        /// </summary>
        public int GoaliePoints { get; set; }
    }
}