namespace NhlFantasyLeague.api.Services
{
    public class NhlPlayerSyncResult
    {
        public int TeamsProcessed { get; set; }

        public int PlayersProcessed { get; set; }

        public int PlayersAdded { get; set; }

        public int PlayersUpdated { get; set; }
    }
}