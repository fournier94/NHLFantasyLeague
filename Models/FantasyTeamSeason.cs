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
        /// Recomputed from scratch every time the refresh endpoint runs.
        /// This is the number used for the season standings.
        /// </summary>
        public int TotalFantasyPoints { get; set; }

        /// <summary>
        /// UTC timestamp of the last successful recompute. Null when
        /// the totals have never been computed for this team and season.
        /// </summary>
        public DateTime? TotalFantasyPointsComputedAt { get; set; }
    }
}