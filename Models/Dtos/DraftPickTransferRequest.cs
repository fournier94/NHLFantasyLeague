namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Request body of POST /api/DraftPick/transfer.
    ///
    /// Moves one draft pick from its current owner to another team.
    /// Only CurrentOwnerFantasyTeamId is rewritten; the pick's
    /// OriginalOwnerFantasyTeamId is left alone so the "came from"
    /// label keeps its full history.
    /// </summary>
    public class DraftPickTransferRequest
    {
        public int PickId { get; set; }
        public int NewOwnerFantasyTeamId { get; set; }
    }
}