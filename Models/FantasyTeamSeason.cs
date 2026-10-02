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
        /// </summary>
        public int TotalFantasyPoints { get; set; }

        /// <summary>
        /// UTC timestamp of the last successful recompute. Null when
        /// the totals have never been computed for this team and season.
        /// </summary>
        public DateTime? TotalFantasyPointsComputedAt { get; set; }

        // -----------------------------------------------------------------
        // Skater aggregates (Active-at-game-time skaters only).
        //
        // "Skater" = Forward, Defense, or Unknown position. Unknown is
        // treated as a skater on purpose: it keeps the totals consistent
        // even when a position has not been set yet.
        // -----------------------------------------------------------------

        public int SkaterGamesPlayed { get; set; }
        public int SkaterGoals { get; set; }
        public int SkaterAssists { get; set; }
        public int SkaterPoints { get; set; }
        public int SkaterHatTricks { get; set; }

        // -----------------------------------------------------------------
        // Goalie aggregates (Active-at-game-time goalies only).
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