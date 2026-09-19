namespace NhlFantasyLeague.api.Models.NHL
{
    public class NhlPlayerBatchResult
    {
        public int PlayersProcessed { get; set; }

        public int PlayersUpdated { get; set; }

        public int PlayersFailed { get; set; }

        public List<string> FailedPlayers { get; set; } = new();
    }
}
