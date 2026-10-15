using NhlFantasyLeague.api.Services.CapFreeze;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlPopulationService
    {
        private readonly NhlPlayerService _nhlPlayerService;
        private readonly CapFreezeSyncService _capFreezeSyncService;
        private readonly ILogger<NhlPopulationService> _logger;

        public NhlPopulationService(
            NhlPlayerService nhlPlayerService,
            CapFreezeSyncService capFreezeSyncService,
            ILogger<NhlPopulationService> logger)
        {
            _nhlPlayerService = nhlPlayerService;
            _capFreezeSyncService = capFreezeSyncService;
            _logger = logger;
        }

        public async Task<object> PopulateEntirePlayerDatabaseAsync()
        {
            // Step 1: Discover all NHL player IDs.
            //
            // Hard failures (stats API down after 5 retries) still
            // throw from inside this call and land in the caller's
            // catch block. That is correct: without player ids
            // there is nothing to populate.
            var discoveryResult =
                await _nhlPlayerService.DiscoverPlayerIdsAsync();

            // Step 2: Populate every discovered player.
            //
            // A partial population is a successful population. The
            // 2,500-player run routinely sees a handful of transient
            // failures against the NHL API's rate limit, and refusing
            // to advance to the CapFreeze step for a few missed
            // landing pages is what produced the 15-minute retry
            // storm that held the heavy lock for hours on 2026-10-14.
            //
            // The missed players are picked up by:
            //   - the next weekly deep refresh (Sun + Wed),
            //   - the 09:15 career-stats refresh (for players who
            //     played the previous day),
            //   - the 07:30 non-NHL landing refresh (for everyone
            //     else).
            //
            // Hard failures (API completely down, zero teams) still
            // throw from their own call sites.
            var populationResult =
                await _nhlPlayerService.PopulatePlayersFromLandingBatchAsync();

            if (populationResult.PlayersFailed > 0)
            {
                _logger.LogWarning(
                    "NHL player population completed with {Failed} " +
                    "failed player(s) out of {Processed}. Continuing " +
                    "to CapFreeze sync; the missed players will be " +
                    "picked up on the next daily or weekly pass.",
                    populationResult.PlayersFailed,
                    populationResult.PlayersProcessed);
            }

            // Step 3: CapFreeze sync runs regardless of partial
            // landing-page failures. The CapFreeze pass walks the
            // NHL team pages and matches to whatever Player rows
            // already exist, so a missing landing page for one
            // player does not block anyone else's contract sync.
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