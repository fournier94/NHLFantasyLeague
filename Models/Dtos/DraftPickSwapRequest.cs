namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Request body of POST /api/DraftPick/swap.
    ///
    /// Swaps the CURRENT owner of two draft picks. Neither pick's
    /// OriginalOwnerFantasyTeamId is changed — only the current
    /// ownership flips. This is the same shape of change that a
    /// manual trade produces, so the audit trail through
    /// OriginalOwner stays intact.
    /// </summary>
    public class DraftPickSwapRequest
    {
        public int PickAId { get; set; }
        public int PickBId { get; set; }
    }
}