using NhlFantasyLeague.api.Services.CapFreeze;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlPopulationService
    {
        private readonly NhlPlayerService _nhlPlayerService;
        private readonly CapFreezeSyncService _capFreezeSyncService;

        public NhlPopulationService(
            NhlPlayerService nhlPlayerService,
            CapFreezeSyncService capFreezeSyncService)
        {
            _nhlPlayerService = nhlPlayerService;
            _capFreezeSyncService = capFreezeSyncService;
        }

        public async Task<object> PopulateEntirePlayerDatabaseAsync()
        {
            // Step 1: Discover all NHL player IDs.
            var discoveryResult =
                await _nhlPlayerService.DiscoverPlayerIdsAsync();

            // Step 2: Fully populate every discovered player.
            // This await is important: CapFreeze will NOT start
            // until this entire operation has actually finished.
            var populationResult =
                await _nhlPlayerService.PopulatePlayersFromLandingBatchAsync();

            // Do not start CapFreeze if any player failed.
            if (populationResult.PlayersFailed > 0)
            {
                throw new InvalidOperationException(
                    $"NHL player population completed with " +
                    $"{populationResult.PlayersFailed} failed player(s). " +
                    "CapFreeze synchronization was not started.");
            }

            // Step 3: Only after NHL player population is complete,
            // synchronize CapFreeze statuses and contracts.
            var capFreezeResult =
                await _capFreezeSyncService.SyncAllCapFreezeTeamsAsync();

            return new
            {
                Discovery = discoveryResult,
                PlayerPopulation = populationResult,
                CapFreeze = capFreezeResult
            };
        }
    }
}