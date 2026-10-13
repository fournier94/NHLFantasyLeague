namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One draft pick owned by a fantasy team, as returned by
    /// GET /api/DraftPick/team/{fantasyTeamId}.
    ///
    /// Each row represents a single round pick in a single draft.
    /// The original owner is the team that was assigned the pick when
    /// the draft was seeded; the current owner is the team that holds
    /// it now. They are equal until the pick is traded.
    /// </summary>
    public class DraftPickDto
    {
        public int Id { get; set; }

        public int DraftId { get; set; }

        /// <summary>Year of the draft, e.g. 2027.</summary>
        public int DraftYear { get; set; }

        /// <summary>NHL season code the draft belongs to, e.g. 20272028.</summary>
        public int NhlSeasonCode { get; set; }

        /// <summary>Display name of the season, e.g. "2027-2028".</summary>
        public string SeasonName { get; set; } = string.Empty;

        /// <summary>Round number, 1-based.</summary>
        public int Round { get; set; }

        /// <summary>Position within the round, 1-based.</summary>
        public int PickNumber { get; set; }

        public int OriginalOwnerFantasyTeamId { get; set; }

        public string OriginalOwnerFantasyTeamName { get; set; } = string.Empty;

        public int CurrentOwnerFantasyTeamId { get; set; }

        /// <summary>
        /// True when the pick has never been traded away from its
        /// original owner. When false, the card shows where it came
        /// from.
        /// </summary>
        public bool IsOriginallyOwned { get; set; }
    }
}