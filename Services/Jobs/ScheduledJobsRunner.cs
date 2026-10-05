using Microsoft.EntityFrameworkCore;
using Microsoft.Extensions.DependencyInjection;
using Microsoft.Extensions.Logging;
using NhlFantasyLeague.api.Services.Health;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Services.Jobs
{
    /// <summary>
    /// Owns the scheduled jobs and their shared state. Registered as a
    /// singleton.
    ///
    /// FIVE JOBS
    ///
    ///   1. Live refresh (11:00 – 02:00 ET, every 7 min).
    ///      Memory only, no DB. Serves the Game Day page.
    ///
    ///   2. Post-game write (02:30 ET, once per day).
    ///      Persists FINAL/OFF games for yesterday's ET date.
    ///      One bulk transaction.
    ///
    ///   3. Daily refresh (08:00 ET, once per day).
    ///      ESPN injuries + NHL/AHL roster locations.
    ///
    ///   4. Career stats refresh (08:30 ET, once per day).
    ///      Landing pages for players who played yesterday.
    ///
    ///   5. Weekly deep refresh (Sunday 03:00 ET).
    ///      Teams, full population, full team-totals recompute.
    ///
    /// Plus an ON-DEMAND recompute: any roster change (swap, trade,
    /// set-status, update) calls RequestRecompute(). The next tick
    /// picks it up and runs a full FantasyTeamSeason recompute for
    /// the current season, so standings update within ~30 s.
    ///
    /// LOCKING MODEL — two independent semaphores:
    ///
    ///   _liveLock  — jobs 1 (memory only, HTTP-bound).
    ///   _heavyLock — jobs 2, 3, 4, 5 (all touch the DB).
    ///
    /// Every job uses WaitAsync(0): if the lock is busy, the job
    /// no-ops and the next tick tries again. The scheduler never
    /// blocks on a long job.
    /// </summary>
    public class ScheduledJobsRunner
    {
        // -----------------------------------------------------------------
        // Schedule constants (all ET)
        // -----------------------------------------------------------------

        /// <summary>Live window opens at 11:00 AM ET (covers weekend afternoon games).</summary>
        private static readonly TimeSpan LiveWindowStartEt = new(11, 0, 0);

        /// <summary>Live window closes at 2:00 AM ET.</summary>
        private static readonly TimeSpan LiveWindowEndEt = new(2, 0, 0);

        private static readonly TimeSpan LiveRefreshInterval = TimeSpan.FromMinutes(7);
        private static readonly TimeSpan PostGameHourEt = new(2, 30, 0);
        private static readonly TimeSpan DailyRefreshHourEt = new(8, 0, 0);
        private static readonly TimeSpan CareerStatsHourEt = new(8, 30, 0);
        private static readonly TimeSpan WeeklyRefreshHourEt = new(3, 0, 0);

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly LiveGameCache _cache;
        private readonly Services.Cache.ResponseCacheService _responseCache;
        private readonly ILogger<ScheduledJobsRunner> _logger;

        private readonly SemaphoreSlim _liveLock = new(1, 1);
        private readonly SemaphoreSlim _heavyLock = new(1, 1);

        // ---- Shared state (in-memory, lost on restart) ----------------
        private readonly object _stateLock = new();
        private DateTime _lastLiveKickUtc = DateTime.MinValue;
        private DateOnly? _lastDailyRefreshEtDate;
        private DateOnly? _lastPostGameWriteEtDate;
        private DateOnly? _lastCareerStatsEtDate;
        private DateOnly? _lastWeeklyRefreshEtDate;
        private bool _recomputeRequested;

        public ScheduledJobsRunner(
            IServiceScopeFactory scopeFactory,
            LiveGameCache cache,
            Services.Cache.ResponseCacheService responseCache,
            ILogger<ScheduledJobsRunner> logger)
        {
            _scopeFactory = scopeFactory;
            _cache = cache;
            _responseCache = responseCache;
            _logger = logger;
        }

        // =================================================================
        // On-demand recompute
        // =================================================================

        /// <summary>
        /// Signals that a roster change happened and the FantasyTeamSeason
        /// aggregates should be recomputed. The next tick picks this up
        /// and runs the recompute. Idempotent: setting the flag twice
        /// in quick succession still results in one recompute.
        /// </summary>
        public void RequestRecompute()
        {
            lock (_stateLock)
            {
                _recomputeRequested = true;
            }
        }

        // =================================================================
        // Tick
        // =================================================================

        public Task TickAsync(CancellationToken ct)
        {
            var nowUtc = DateTime.UtcNow;
            var nowEt = TimeZoneHelper.ToEastern(nowUtc);
            var todayEt = DateOnly.FromDateTime(nowEt);
            var timeOfDayEt = nowEt.TimeOfDay;

            // ---- 0. On-demand recompute -------------------------------
            bool recomputeNow;
            lock (_stateLock)
            {
                recomputeNow = _recomputeRequested;
                if (recomputeNow) _recomputeRequested = false;
            }

            if (recomputeNow)
            {
                FireAndForget(
                    ct,
                    "On-demand recompute",
                    () => RunRecomputeAsync(ct));
            }

            // ---- 1. Live refresh --------------------------------------
            if (IsInsideLiveWindow(timeOfDayEt))
            {
                bool kick;
                lock (_stateLock)
                {
                    kick = nowUtc - _lastLiveKickUtc >= LiveRefreshInterval;
                    if (kick) _lastLiveKickUtc = nowUtc;
                }

                if (kick)
                {
                    FireAndForget(
                        ct,
                        "Live refresh",
                        () => RunLiveRefreshAsync(ct));
                }
            }

            // ---- 2. Post-game write -----------------------------------
            // NOTE: do NOT set the date flag here. The flag is set
            // inside RunPostGameWriteAsync only after the heavy lock
            // is acquired. Otherwise a job that loses the lock race
            // would be silently skipped for the entire day.
            if (timeOfDayEt >= PostGameHourEt)
            {
                bool shouldTry;
                lock (_stateLock)
                {
                    shouldTry = _lastPostGameWriteEtDate != todayEt;
                }

                if (shouldTry)
                {
                    var target = todayEt.AddDays(-1);
                    FireAndForget(
                        ct,
                        $"Post-game write for {target}",
                        () => RunPostGameWriteAsync(target, ct));
                }
            }

            // ---- 5. Weekly deep refresh (Sundays) ---------------------
            if (nowEt.DayOfWeek == DayOfWeek.Sunday &&
                timeOfDayEt >= WeeklyRefreshHourEt)
            {
                bool shouldTry;
                lock (_stateLock)
                {
                    shouldTry = _lastWeeklyRefreshEtDate != todayEt;
                }

                if (shouldTry)
                {
                    FireAndForget(
                        ct,
                        "Weekly deep refresh",
                        () => RunWeeklyRefreshAsync(ct));
                }
            }

            // ---- 3. Daily refresh -------------------------------------
            if (timeOfDayEt >= DailyRefreshHourEt)
            {
                bool shouldTry;
                lock (_stateLock)
                {
                    shouldTry = _lastDailyRefreshEtDate != todayEt;
                }

                if (shouldTry)
                {
                    FireAndForget(
                        ct,
                        "Daily refresh",
                        () => RunDailyRefreshAsync(ct));
                }
            }

            // ---- 4. Career stats refresh ------------------------------
            if (timeOfDayEt >= CareerStatsHourEt)
            {
                bool shouldTry;
                lock (_stateLock)
                {
                    shouldTry = _lastCareerStatsEtDate != todayEt;
                }

                if (shouldTry)
                {
                    var target = todayEt.AddDays(-1);
                    FireAndForget(
                        ct,
                        $"Career stats refresh for {target}",
                        () => RunCareerStatsRefreshAsync(target, ct));
                }
            }

            return Task.CompletedTask;
        }

        private void FireAndForget(
            CancellationToken ct,
            string jobName,
            Func<Task> work)
        {
            _ = Task.Run(async () =>
            {
                try
                {
                    await work();
                }
                catch (OperationCanceledException)
                {
                    // Shutting down.
                }
                catch (Exception ex)
                {
                    _logger.LogError(
                        ex, "{JobName} threw.", jobName);
                }
            }, ct);
        }

        private static bool IsInsideLiveWindow(TimeSpan timeOfDayEt)
        {
            return timeOfDayEt >= LiveWindowStartEt ||
                   timeOfDayEt < LiveWindowEndEt;
        }

        // =================================================================
        // Job 0: on-demand recompute
        // =================================================================

        /// <summary>
        /// Recomputes every FantasyTeamSeason aggregate for the current
        /// season. Triggered by RequestRecompute(), which the roster
        /// admin service calls after any swap / trade / release.
        /// </summary>
        public async Task RunRecomputeAsync(CancellationToken ct = default)
        {
            if (!await _heavyLock.WaitAsync(0, ct))
            {
                // A heavy job is already running. Re-set the flag so
                // the next tick retries.
                RequestRecompute();
                return;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();

                var gameLogService = scope.ServiceProvider
                    .GetRequiredService<NhlGameLogService>();

                var seasonCode = await GetCurrentSeasonCodeAsync(scope);

                if (!seasonCode.HasValue)
                {
                    _logger.LogWarning(
                        "On-demand recompute skipped: no current season.");
                    return;
                }

                var result = await gameLogService
                    .RecomputeTeamSeasonTotalsAsync(seasonCode.Value, ct);

                // Standings are stale now. The next read rebuilds from
                // the freshly recomputed FantasyTeamSeason rows.
                _responseCache.Invalidate("standings:");

                _logger.LogInformation(
                    "On-demand recompute done. Teams={Teams}, " +
                    "GamesCredited={Games}.",
                    result.TeamsProcessed,
                    result.GamesCredited);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "On-demand recompute failed.");
            }
            finally
            {
                _heavyLock.Release();
            }
        }

        // =================================================================
        // Job 1: live refresh
        // =================================================================

        public async Task RunLiveRefreshAsync(CancellationToken ct = default)
        {
            if (!await _liveLock.WaitAsync(0, ct))
            {
                return;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();
                var gameService = scope.ServiceProvider
                    .GetRequiredService<NhlGameService>();

                var result = await gameService
                    .RefreshLiveGamesCacheAsync(_cache, ct);

                // Standings changed if any live deltas were persisted.
                // The standings read cache is short (30 s), so dropping
                // it now makes the next request see the fresh totals
                // within the same tick.
                if (result.GamesPersisted > 0)
                {
                    _responseCache.Invalidate("standings:");
                }

                if (result.Errors.Count > 0)
                {
                    _logger.LogWarning(
                        "Live refresh finished with {Errors} error(s). " +
                        "Fetched {Fetched} boxscore(s) for {Games} game(s), " +
                        "persisted {Persisted}.",
                        result.Errors.Count,
                        result.BoxscoresFetched,
                        result.SnapshotCount,
                        result.GamesPersisted);
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Live refresh failed.");
            }
            finally
            {
                _liveLock.Release();
            }
        }

        // =================================================================
        // Job 2: post-game write
        // =================================================================

        public async Task RunPostGameWriteAsync(
       DateOnly targetEtDate,
       CancellationToken ct = default)
        {
            if (!await _heavyLock.WaitAsync(0, ct))
            {
                _logger.LogInformation(
                    "Post-game write skipped: another heavy job is running.");
                return;
            }

            // Lock acquired. Mark today's run as done now, so that
            // even if the job body throws, the next tick does not
            // re-run it.
            lock (_stateLock)
            {
                _lastPostGameWriteEtDate = DateOnly.FromDateTime(
                    TimeZoneHelper.ToEastern(DateTime.UtcNow));
            }

            try
            {
                _logger.LogInformation(
                    "Post-game write starting for ET date {Date}.",
                    targetEtDate);

                using var scope = _scopeFactory.CreateScope();
                var gameService = scope.ServiceProvider
                    .GetRequiredService<NhlGameService>();

                var result = await gameService
                    .PersistFinalGamesForDateAsync(targetEtDate, ct);

                _logger.LogInformation(
                    "Post-game write done. Games={Games}, " +
                    "Inserted={Inserted}, Updated={Updated}, " +
                    "SeasonStatsInserted={SeasonStatsInserted}, " +
                    "TeamDelta={TeamDelta}, Errors={Errors}.",
                    result.FinalGamesOnSchedule,
                    result.GameLogsInserted,
                    result.GameLogsUpdated,
                    result.SeasonStatsInserted,
                    result.TotalFantasyPointsDelta,
                    result.Errors.Count);

                // Standings changed. Drop the cached copies so the
                // next read reflects the fresh totals.
                _responseCache.Invalidate("standings:");
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Post-game write failed for ET date {Date}.",
                    targetEtDate);
            }
            finally
            {
                _heavyLock.Release();
            }
        }

        // =================================================================
        // Job 3: daily refresh (injuries + roster locations)
        // =================================================================

        public async Task RunDailyRefreshAsync(CancellationToken ct = default)
        {
            if (!await _heavyLock.WaitAsync(0, ct))
            {
                _logger.LogInformation(
                    "Daily refresh skipped: another heavy job is running.");
                return;
            }

            lock (_stateLock)
            {
                _lastDailyRefreshEtDate = DateOnly.FromDateTime(
                    TimeZoneHelper.ToEastern(DateTime.UtcNow));
            }

            try
            {
                _logger.LogInformation("Daily refresh starting.");

                using var scope = _scopeFactory.CreateScope();

                var injuryService = scope.ServiceProvider
                    .GetRequiredService<NhlInjuryService>();

                var rosterStatusService = scope.ServiceProvider
                    .GetRequiredService<PlayerRosterStatusService>();

                try
                {
                    var injuryResult = await injuryService.RefreshAsync(ct);

                    _logger.LogInformation(
                        "Daily injuries: {Matched} matched, " +
                        "{Unmatched} unmatched.",
                        injuryResult.MatchedCount,
                        injuryResult.UnmatchedCount);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "Daily injury refresh failed.");
                }

                try
                {
                    var rosterResult = await rosterStatusService
                        .RefreshAsync(null, ct);

                    _logger.LogInformation(
                        "Daily roster status: {Nhl} NHL, {Ahl} AHL, " +
                        "{Injured} injured, {Out} out.",
                        rosterResult.NhlRosterCount,
                        rosterResult.AhlRosterCount,
                        rosterResult.InjuredCount,
                        rosterResult.NotOnActiveRosterCount);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "Daily roster status refresh failed.");
                }

                _logger.LogInformation("Daily refresh done.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Daily refresh failed.");
            }
            finally
            {
                _heavyLock.Release();
            }
        }

        // =================================================================
        // Job 4: career stats refresh (last night's players)
        // =================================================================

        /// <summary>
        /// Refreshes landing data for every player who appeared in a
        /// game on the given date. Keeps the player pages (career
        /// table, bio, draft info, current-season totals) current
        /// without running the full 2,500-player weekly population.
        ///
        /// Typical cost: ~200-400 HTTP calls, ~5 minutes, one heavy
        /// lock hold.
        /// </summary>
        public async Task RunCareerStatsRefreshAsync(
      DateOnly targetEtDate,
      CancellationToken ct = default)
        {
            if (!await _heavyLock.WaitAsync(0, ct))
            {
                _logger.LogInformation(
                    "Career stats refresh skipped: another heavy job " +
                    "is running.");
                return;
            }

            lock (_stateLock)
            {
                _lastCareerStatsEtDate = DateOnly.FromDateTime(
                    TimeZoneHelper.ToEastern(DateTime.UtcNow));
            }

            try
            {
                _logger.LogInformation(
                    "Career stats refresh starting for ET date {Date}.",
                    targetEtDate);

                using var scope = _scopeFactory.CreateScope();
                var playerService = scope.ServiceProvider
                    .GetRequiredService<NhlPlayerService>();

                var result = await playerService
                    .RefreshPlayersWhoPlayedOnAsync(targetEtDate, 500, ct);

                _logger.LogInformation(
                    "Career stats refresh done. Total={Total}, " +
                    "Refreshed={Refreshed}, Failed={Failed}, " +
                    "NoLanding={NoLanding}.",
                    result.TotalPlayers,
                    result.PlayersRefreshed,
                    result.FailedPlayers,
                    result.SkippedNoLandingData);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex, "Career stats refresh failed.");
            }
            finally
            {
                _heavyLock.Release();
            }
        }

        // =================================================================
        // Job 5: weekly deep refresh
        // =================================================================

        public async Task RunWeeklyRefreshAsync(CancellationToken ct = default)
        {
            if (!await _heavyLock.WaitAsync(0, ct))
            {
                _logger.LogInformation(
                    "Weekly refresh skipped: another heavy job is running.");
                return;
            }

            lock (_stateLock)
            {
                _lastWeeklyRefreshEtDate = DateOnly.FromDateTime(
                    TimeZoneHelper.ToEastern(DateTime.UtcNow));
            }

            try
            {
                _logger.LogInformation("Weekly deep refresh starting.");

                using var scope = _scopeFactory.CreateScope();

                try
                {
                    var teamService = scope.ServiceProvider
                        .GetRequiredService<NhlTeamService>();

                    var teams = await teamService.SyncTeamsAsync();
                    _logger.LogInformation(
                        "Weekly teams sync: {Count} teams.", teams.Count);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Weekly team sync failed.");
                }

                try
                {
                    var populationService = scope.ServiceProvider
                        .GetRequiredService<NhlPopulationService>();

                    await populationService.PopulateEntirePlayerDatabaseAsync();

                    _logger.LogInformation(
                        "Weekly player population done.");
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "Weekly player population failed.");
                }

                try
                {
                    var gameLogService = scope.ServiceProvider
                        .GetRequiredService<NhlGameLogService>();

                    var seasonCode = await GetCurrentSeasonCodeAsync(scope);

                    if (seasonCode.HasValue)
                    {
                        var totals = await gameLogService
                            .RecomputeTeamSeasonTotalsAsync(
                                seasonCode.Value, ct);

                        // Standings are stale now.
                        _responseCache.Invalidate("standings:");

                        _logger.LogInformation(
                            "Weekly recompute: {Teams} teams, " +
                            "{Games} games credited.",
                            totals.TeamsProcessed,
                            totals.GamesCredited);
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(ex, "Weekly recompute failed.");
                }

                _logger.LogInformation("Weekly deep refresh done.");
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Weekly deep refresh failed.");
            }
            finally
            {
                _heavyLock.Release();
            }
        }

        private static async Task<int?> GetCurrentSeasonCodeAsync(
            IServiceScope scope)
        {
            var db = scope.ServiceProvider
                .GetRequiredService<NhlFantasyLeague.api.Data.AppDbContext>();

            var season = await db.Seasons
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync();

            return season?.NhlSeasonCode;
        }
    }
}