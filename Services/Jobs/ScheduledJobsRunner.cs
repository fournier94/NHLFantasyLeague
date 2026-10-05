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
    /// JOBS
    ///
    ///   Deep refresh             Sunday + Wednesday 03:00 ET, twice per week.
    ///   Post-game write          02:30 ET, once per day.
    ///   Season reconciliation    05:00, 10:00, 15:00 ET.
    ///   Daily cleanup            08:00 ET, once per day.
    ///   Career stats refresh     08:30 ET, once per day.
    ///   On-demand recompute      any time a roster mutation fires.
    ///   Frequent refresh         every 30 min, 24/7.
    ///   Live refresh             11:00 – 02:00 ET, every 60 sec.
    ///
    /// LOCKING MODEL — two independent semaphores:
    ///
    ///   _liveLock  — live refresh only (memory-only, HTTP-bound).
    ///   _heavyLock — every other job (all touch the DB).
    ///
    /// PRIORITY
    ///
    /// The heavy lock serializes every DB-touching job: only one runs
    /// at a time. Every job uses WaitAsync(0), so a job that loses the
    /// race skips this tick and retries 30 seconds later. Because the
    /// tick fires jobs in priority order, RARE jobs (weekly, daily)
    /// always get the first crack at a free lock and can never be
    /// starved by FREQUENT ones (frequent refresh).
    ///
    /// Priority order, most important first:
    ///
    ///   1. Weekly deep refresh       (once a week, must not miss)
    ///   2. Post-game write           (once a day, timing-sensitive)
    ///   3. Season reconciliation     (3 slots per day)
    ///   4. Career stats refresh      (once a day)
    ///   5. Daily cleanup             (once a day, very fast)
    ///   6. On-demand recompute       (user-triggered, retries via flag)
    ///   7. Frequent refresh          (many times a day, best-effort)
    ///
    /// The live refresh uses a separate lock so it never competes.
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

        // How often the live-refresh job fires during the live window.
        // 60 seconds matches the NHL boxscore's natural freshness and
        // gives users near-real-time goal updates without hammering the
        // API. If the NHL starts returning 429s, back this off to 2 min.
        private static readonly TimeSpan LiveRefreshInterval = TimeSpan.FromSeconds(60);
        private static readonly TimeSpan PostGameHourEt = new(2, 30, 0);
        private static readonly TimeSpan DailyRefreshHourEt = new(8, 0, 0);
        private static readonly TimeSpan CareerStatsHourEt = new(8, 30, 0);
        private static readonly TimeSpan WeeklyRefreshHourEt = new(3, 0, 0);

        // Season reconciliation: three times a day, re-fetch every
        // player's current-season game logs and landing page, then
        // rebuild the team totals. Used as a safety net for late
        // stat corrections from the NHL.
        private static readonly TimeSpan Reconciliation5AmHourEt = new(5, 0, 0);
        private static readonly TimeSpan Reconciliation10AmHourEt = new(10, 0, 0);
        private static readonly TimeSpan Reconciliation3PmHourEt = new(15, 0, 0);

        // The 15:00 ET reconciliation is skipped when any NHL game
        // starts before this cutoff. Afternoon matinees overlap with
        // the run and the live refresh already keeps them current.
        private static readonly TimeSpan AfternoonGameCutoffEt = new(16, 0, 0);

        // Frequent refresh: injuries + roster status. Runs every 30
        // minutes around the clock. Injuries and callups can change
        // any time, so we keep this cadence high. ~63 HTTP calls and
        // ~90 seconds per run.
        private static readonly TimeSpan FrequentRefreshInterval =
            TimeSpan.FromMinutes(30);

        private readonly IServiceScopeFactory _scopeFactory;
        private readonly LiveGameCache _cache;
        private readonly Services.Cache.ResponseCacheService _responseCache;
        private readonly ILogger<ScheduledJobsRunner> _logger;

        private readonly SemaphoreSlim _liveLock = new(1, 1);
        private readonly SemaphoreSlim _heavyLock = new(1, 1);

        /// <summary>
        /// A heavy job that holds the lock for longer than this is
        /// considered stuck. The watchdog logs a warning once per hold.
        /// </summary>
        private static readonly TimeSpan HeavyLockStuckThreshold =
            TimeSpan.FromMinutes(30);

        // ---- Stable job names ----------------------------------------
        //
        // Used both as keys in _lastCompletedEtDateByJob / _inProgressJobs
        // and as log labels. Keep them stable: renaming a constant resets
        // the "completed today" state on the next deploy.
        private const string JobWeeklyRefresh = "Weekly deep refresh";
        private const string JobPostGameWrite = "Post-game write";
        private const string JobCareerStatsRefresh = "Career stats refresh";
        private const string JobDailyCleanup = "Daily cleanup";
        private const string JobReconciliation5Am = "Season reconciliation (05:00 ET)";
        private const string JobReconciliation10Am = "Season reconciliation (10:00 ET)";
        private const string JobReconciliation3Pm = "Season reconciliation (15:00 ET)";

        // ---- Shared state (in-memory, lost on restart) ----------------
        private readonly object _stateLock = new();

        /// <summary>
        /// Once-per-day jobs that have completed successfully today, keyed
        /// by job name. The value is the ET calendar date of the last
        /// successful completion. Set only at the END of a run, so a
        /// failed or interrupted job is retried on the next tick.
        /// </summary>
        private readonly Dictionary<string, DateOnly> _lastCompletedEtDateByJob =
            new(StringComparer.Ordinal);

        /// <summary>
        /// Long-running jobs that are currently executing. Used by the
        /// tick to avoid re-firing a job that is already running, since
        /// the "completed today" flag is now only set at the end.
        /// </summary>
        private readonly HashSet<string> _inProgressJobs =
            new(StringComparer.Ordinal);

        /// <summary>
        /// Earliest UTC instant each once-per-day job may fire again
        /// after a failed attempt. Prevents a persistent failure
        /// (e.g. an upstream 429 storm) from becoming a retry storm:
        /// the next tick will skip the job until this instant passes.
        /// Cleared automatically on a successful run because the
        /// "completed today" flag then takes over.
        /// </summary>
        private readonly Dictionary<string, DateTime> _nextAttemptAllowedUtcByJob =
            new(StringComparer.Ordinal);

        /// <summary>
        /// How long to wait after a once-per-day job fails before
        /// retrying it. Chosen so a persistently failing job retries
        /// roughly once every 10 minutes instead of twice a minute,
        /// while still guaranteeing it eventually completes today if
        /// the underlying issue clears.
        /// </summary>
        private static readonly TimeSpan FailureBackoff =
            TimeSpan.FromMinutes(10);

        /// <summary>UTC instant the heavy lock was last acquired (watchdog).</summary>
        private DateTime _heavyLockAcquiredAtUtc = DateTime.MinValue;

        /// <summary>Job name that currently holds the heavy lock (watchdog).</summary>
        private string? _heavyLockOwnerJobName;

        /// <summary>True once the watchdog has logged a stuck-lock warning for the current hold.</summary>
        private bool _heavyLockStuckWarningIssued;

        private DateTime _lastLiveKickUtc = DateTime.MinValue;
        private DateTime _lastFrequentRefreshKickUtc = DateTime.MinValue;
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
        // Heavy lock helpers + watchdog
        // =================================================================

        /// <summary>
        /// Acquires the heavy lock without waiting, and records the
        /// owner + instant so the watchdog can flag a stuck hold.
        /// Always uses <see cref="CancellationToken.None"/>: the tick
        /// only fires this after it has decided to run the job, and we
        /// never want a shutdown cancellation to slip in between.
        /// </summary>
        private async Task<bool> TryAcquireHeavyLockAsync(
            string jobName,
            CancellationToken ct)
        {
            if (!await _heavyLock.WaitAsync(0, CancellationToken.None))
            {
                return false;
            }

            lock (_stateLock)
            {
                _heavyLockAcquiredAtUtc = DateTime.UtcNow;
                _heavyLockOwnerJobName = jobName;
                _heavyLockStuckWarningIssued = false;
            }

            return true;
        }

        private void ReleaseHeavyLock()
        {
            lock (_stateLock)
            {
                _heavyLockAcquiredAtUtc = DateTime.MinValue;
                _heavyLockOwnerJobName = null;
            }

            _heavyLock.Release();
        }

        /// <summary>
        /// Logs a single warning per lock hold when the heavy lock has
        /// been held for longer than <see cref="HeavyLockStuckThreshold"/>.
        /// Called by the tick. Never throws.
        /// </summary>
        private void CheckHeavyLockHealth()
        {
            string? owner;
            TimeSpan held;

            lock (_stateLock)
            {
                if (_heavyLockAcquiredAtUtc == DateTime.MinValue) return;
                if (_heavyLockStuckWarningIssued) return;

                held = DateTime.UtcNow - _heavyLockAcquiredAtUtc;

                if (held < HeavyLockStuckThreshold) return;

                _heavyLockStuckWarningIssued = true;
                owner = _heavyLockOwnerJobName;
            }

            _logger.LogWarning(
                "Heavy lock has been held by '{Owner}' for {Minutes:F1} " +
                "minutes. Watchdog warning.",
                owner ?? "(unknown)",
                held.TotalMinutes);

            _ = RecordLockStuckAsync(owner, held);
        }

        private async Task RecordLockStuckAsync(string? owner, TimeSpan held)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();

                var log = scope.ServiceProvider
                    .GetRequiredService<
                        NhlFantasyLeague.api.Services.Logging.SystemEventLogService
                    >();

                await log.RecordAsync(
                    source: "ScheduledJobsRunner",
                    category: "HeavyLockStuck",
                    severity: "Warning",
                    message:
                        $"Heavy lock held by '{owner ?? "(unknown)"}' for " +
                        $"{held.TotalMinutes:F1} minutes.",
                    details: null);
            }
            catch
            {
                // Never let the watchdog cascade.
            }
        }

        // =================================================================
        // Once-per-day job runner
        // =================================================================

        /// <summary>
        /// True when the given once-per-day job should fire on this
        /// tick. Three conditions must all hold:
        ///   1. the job is not currently in progress;
        ///   2. it has not completed successfully for the given ET
        ///      calendar date;
        ///   3. if it failed recently, the failure backoff has elapsed.
        /// </summary>
        private bool ShouldFireOncePerDayJob(
            string jobName,
            DateOnly todayEt)
        {
            lock (_stateLock)
            {
                if (_inProgressJobs.Contains(jobName))
                {
                    return false;
                }

                var alreadyCompletedToday =
                    _lastCompletedEtDateByJob.TryGetValue(
                        jobName, out var lastCompleted)
                    && lastCompleted == todayEt;

                if (alreadyCompletedToday)
                {
                    return false;
                }

                if (_nextAttemptAllowedUtcByJob.TryGetValue(
                        jobName, out var nextAllowed)
                    && DateTime.UtcNow < nextAllowed)
                {
                    return false;
                }

                return true;
            }
        }

        /// <summary>
        /// Fires the given once-per-day job on the thread pool.
        ///
        ///   * The work runs with <see cref="CancellationToken.None"/>,
        ///     so a graceful app shutdown does NOT cancel it mid-run.
        ///   * The "completed today" flag is set by the job itself, only
        ///     on success. A failed or early-returned run leaves the
        ///     flag unset, so the next tick retries.
        ///   * The in-progress set is cleared in a finally, so a job
        ///     that failed to grab the heavy lock is retried next tick.
        /// </summary>
        private void FireOncePerDayJob(
      string jobName,
      Func<CancellationToken, Task> work)
        {
            lock (_stateLock)
            {
                if (!_inProgressJobs.Add(jobName))
                {
                    // Should not happen: ShouldFireOncePerDayJob already
                    // guarded against it. Belt and suspenders.
                    return;
                }
            }

            _ = Task.Run(async () =>
            {
                try
                {
                    await work(CancellationToken.None);
                }
                catch (OperationCanceledException)
                {
                    // Should not happen with CancellationToken.None. If
                    // it does, we do NOT mark the job as done, so the
                    // next tick retries.
                }
                catch (Exception ex)
                {
                    _logger.LogError(ex, "{JobName} failed.", jobName);
                    await RecordJobFailureAsync(jobName, ex);

                    // Apply the failure backoff: the next attempt is
                    // blocked until FailureBackoff elapses. Prevents a
                    // persistent failure (e.g. an upstream 429 storm)
                    // from turning into a retry every 30 seconds.
                    lock (_stateLock)
                    {
                        _nextAttemptAllowedUtcByJob[jobName] =
                            DateTime.UtcNow + FailureBackoff;
                    }
                }
                finally
                {
                    lock (_stateLock)
                    {
                        _inProgressJobs.Remove(jobName);
                    }
                }
            });
        }

        /// <summary>
        /// Marks a once-per-day job as successfully completed for the
        /// given ET calendar date. Called by the job itself at the very
        /// end, only when the work finished without throwing.
        /// </summary>
        private void MarkJobCompleted(
            string jobName,
            DateOnly completedEtDate)
        {
            lock (_stateLock)
            {
                _lastCompletedEtDateByJob[jobName] = completedEtDate;
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

            // Watchdog: flag a heavy lock that has been held too long.
            // Called on every tick, cheap when the lock is idle.
            CheckHeavyLockHealth();

            // -----------------------------------------------------------------
            // Jobs are evaluated in priority order. When multiple jobs
            // fire in the same tick, the first one to grab the heavy
            // lock runs; the rest skip and retry next tick. Because the
            // once-per-day jobs use a "completed today" flag that is
            // only set on success, a job that loses the lock race is
            // NEVER silently skipped for the day — it simply retries
            // on the next 30-second tick.
            // -----------------------------------------------------------------

            // ---- Priority 1: deep refresh (Sunday + Wednesday) --------
            // Runs twice a week at 03:00 ET. The "completed today" flag
            // is keyed per ET calendar day, so the job simply fires
            // once on Sunday and once on Wednesday with no extra state.
            var isDeepRefreshDay =
                nowEt.DayOfWeek == DayOfWeek.Sunday ||
                nowEt.DayOfWeek == DayOfWeek.Wednesday;

            if (isDeepRefreshDay &&
                timeOfDayEt >= WeeklyRefreshHourEt &&
                ShouldFireOncePerDayJob(JobWeeklyRefresh, todayEt))
            {
                FireOncePerDayJob(JobWeeklyRefresh, RunWeeklyRefreshAsync);
            }

            // ---- Priority 2: post-game write --------------------------
            if (timeOfDayEt >= PostGameHourEt &&
                ShouldFireOncePerDayJob(JobPostGameWrite, todayEt))
            {
                var target = todayEt.AddDays(-1);

                FireOncePerDayJob(
                    JobPostGameWrite,
                    jobCt => RunPostGameWriteAsync(target, jobCt));
            }

            // ---- Priority 3: season reconciliation (05:00 ET) ---------
            if (timeOfDayEt >= Reconciliation5AmHourEt &&
                ShouldFireOncePerDayJob(JobReconciliation5Am, todayEt))
            {
                FireOncePerDayJob(
                    JobReconciliation5Am,
                    jobCt => RunSeasonReconciliationAsync(
                        "05:00", JobReconciliation5Am, todayEt, jobCt));
            }

            // ---- Priority 4: season reconciliation (10:00 ET) ---------
            if (timeOfDayEt >= Reconciliation10AmHourEt &&
                ShouldFireOncePerDayJob(JobReconciliation10Am, todayEt))
            {
                FireOncePerDayJob(
                    JobReconciliation10Am,
                    jobCt => RunSeasonReconciliationAsync(
                        "10:00", JobReconciliation10Am, todayEt, jobCt));
            }

            // ---- Priority 5: season reconciliation (15:00 ET) ---------
            if (timeOfDayEt >= Reconciliation3PmHourEt &&
                ShouldFireOncePerDayJob(JobReconciliation3Pm, todayEt))
            {
                FireOncePerDayJob(
                    JobReconciliation3Pm,
                    jobCt => RunSeasonReconciliationAsync(
                        "15:00", JobReconciliation3Pm, todayEt, jobCt));
            }

            // ---- Priority 6: career stats refresh ---------------------
            if (timeOfDayEt >= CareerStatsHourEt &&
                ShouldFireOncePerDayJob(JobCareerStatsRefresh, todayEt))
            {
                var target = todayEt.AddDays(-1);

                FireOncePerDayJob(
                    JobCareerStatsRefresh,
                    jobCt => RunCareerStatsRefreshAsync(target, jobCt));
            }

            // ---- Priority 7: daily cleanup ----------------------------
            if (timeOfDayEt >= DailyRefreshHourEt &&
                ShouldFireOncePerDayJob(JobDailyCleanup, todayEt))
            {
                FireOncePerDayJob(JobDailyCleanup, RunDailyRefreshAsync);
            }

            // ---- Priority 8: on-demand recompute ----------------------
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
                    () => RunRecomputeAsync(CancellationToken.None));
            }

            // ---- Priority 9: frequent refresh -------------------------
            {
                bool kick;
                lock (_stateLock)
                {
                    kick = nowUtc - _lastFrequentRefreshKickUtc
                        >= FrequentRefreshInterval;

                    if (kick) _lastFrequentRefreshKickUtc = nowUtc;
                }

                if (kick)
                {
                    FireAndForget(
                        ct,
                        "Frequent refresh (injuries + rosters)",
                        () => RunFrequentRefreshAsync(ct));
                }
            }

            // ---- Priority 10: live refresh (separate lock) ------------
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

                    await RecordJobFailureAsync(jobName, ex);
                }
            }, ct);
        }

        /// <summary>
        /// Records a scheduled-job failure into SystemEventLogs so it
        /// shows up on the admin page. Never throws.
        /// </summary>
        private async Task RecordJobFailureAsync(
            string jobName,
            Exception ex)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();
                var log = scope.ServiceProvider
                    .GetRequiredService<
                        NhlFantasyLeague.api.Services.Logging.SystemEventLogService
                    >();

                var details = ex.StackTrace is null
                    ? ex.Message
                    : ex.Message + "\n\n" + ex.StackTrace;

                await log.RecordAsync(
                    source: $"ScheduledJob:{jobName}",
                    category: "JobFailure",
                    severity: "Error",
                    message: $"{ex.GetType().Name}: {ex.Message}",
                    details: details);
            }
            catch
            {
                // Never let logging failures cascade.
            }
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
            if (!await TryAcquireHeavyLockAsync("On-demand recompute", ct))
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
                ReleaseHeavyLock();
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
            if (!await TryAcquireHeavyLockAsync(JobPostGameWrite, ct))
            {
                _logger.LogInformation(
                    "Post-game write skipped: another heavy job is running.");
                return;
            }

            var completedEtDate = DateOnly.FromDateTime(
                TimeZoneHelper.ToEastern(DateTime.UtcNow));

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

                // Only mark the job as done-for-today on success. A
                // throw leaves the flag unset so the next tick retries.
                MarkJobCompleted(JobPostGameWrite, completedEtDate);
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
                ReleaseHeavyLock();
            }
        }

        // =================================================================
        // Frequent refresh: injuries + roster status (every 30 min)
        // =================================================================

        /// <summary>
        /// Runs the injury (ESPN) and roster status (NHL + AHL)
        /// refreshes. Fires every 30 minutes, 24/7.
        ///
        /// Uses WaitAsync(0) on the heavy lock: if any other heavy
        /// job is running, this run is skipped and the next kick
        /// (30 min later) picks it up. The 30-minute interval is
        /// enforced by _lastFrequentRefreshKickUtc, not by a success
        /// flag, so a skipped run does not cause a retry storm.
        ///
        /// Typical cost: ~63 HTTP calls, ~90 seconds.
        /// </summary>
        private async Task RunFrequentRefreshAsync(
     CancellationToken ct = default)
        {
            if (!await TryAcquireHeavyLockAsync(
                    "Frequent refresh (injuries + rosters)", ct))
            {
                _logger.LogInformation(
                    "Frequent refresh skipped: another heavy job is " +
                    "running.");
                return;
            }

            try
            {
                using var scope = _scopeFactory.CreateScope();

                var injuryService = scope.ServiceProvider
                    .GetRequiredService<NhlInjuryService>();

                var rosterStatusService = scope.ServiceProvider
                    .GetRequiredService<PlayerRosterStatusService>();

                try
                {
                    var injuryResult = await injuryService.RefreshAsync(ct);

                    _logger.LogInformation(
                        "Frequent injuries: {Matched} matched, " +
                        "{Unmatched} unmatched.",
                        injuryResult.MatchedCount,
                        injuryResult.UnmatchedCount);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "Frequent injury refresh failed.");
                }

                try
                {
                    var rosterResult = await rosterStatusService
                        .RefreshAsync(null, ct);

                    _logger.LogInformation(
                        "Frequent roster status: {Nhl} NHL, {Ahl} AHL, " +
                        "{Injured} injured, {Out} out.",
                        rosterResult.NhlRosterCount,
                        rosterResult.AhlRosterCount,
                        rosterResult.InjuredCount,
                        rosterResult.NotOnActiveRosterCount);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "Frequent roster status refresh failed.");
                }
            }
            finally
            {
                ReleaseHeavyLock();
            }
        }


        // =================================================================
        // Job 3: daily cleanup (SystemEventLog retention)
        // =================================================================

        public async Task RunDailyRefreshAsync(CancellationToken ct = default)
        {
            if (!await TryAcquireHeavyLockAsync(JobDailyCleanup, ct))
            {
                _logger.LogInformation(
                    "Daily refresh skipped: another heavy job is running.");
                return;
            }

            var completedEtDate = DateOnly.FromDateTime(
                TimeZoneHelper.ToEastern(DateTime.UtcNow));

            try
            {
                // NOTE: injuries and roster status were moved to the
                // frequent refresh (every 30 min). This job now only
                // runs the daily housekeeping tasks that do not need
                // to run more than once a day.
                _logger.LogInformation("Daily cleanup starting.");

                try
                {
                    using var logScope = _scopeFactory.CreateScope();
                    var logService = logScope.ServiceProvider
                        .GetRequiredService<
                            NhlFantasyLeague.api.Services.Logging.SystemEventLogService
                        >();

                    await logService.CleanupAsync(ct);
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex, "SystemEventLog cleanup failed.");
                }

                _logger.LogInformation("Daily cleanup done.");

                // Only mark the job as done-for-today on success. A
                // throw above leaves the flag unset so the next tick
                // retries.
                MarkJobCompleted(JobDailyCleanup, completedEtDate);
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Daily refresh failed.");
            }
            finally
            {
                ReleaseHeavyLock();
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
            if (!await TryAcquireHeavyLockAsync(JobCareerStatsRefresh, ct))
            {
                _logger.LogInformation(
                    "Career stats refresh skipped: another heavy job " +
                    "is running.");
                return;
            }

            var completedEtDate = DateOnly.FromDateTime(
                TimeZoneHelper.ToEastern(DateTime.UtcNow));

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

                // Only mark the job as done-for-today on success. A
                // throw above leaves the flag unset so the next tick
                // retries.
                MarkJobCompleted(JobCareerStatsRefresh, completedEtDate);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex, "Career stats refresh failed.");
            }
            finally
            {
                ReleaseHeavyLock();
            }
        }

        // =================================================================
        // Job 5: weekly deep refresh
        // =================================================================

        public async Task RunWeeklyRefreshAsync(CancellationToken ct = default)
        {
            if (!await TryAcquireHeavyLockAsync(JobWeeklyRefresh, ct))
            {
                _logger.LogInformation(
                    "Weekly refresh skipped: another heavy job is running.");
                return;
            }

            var completedEtDate = DateOnly.FromDateTime(
                TimeZoneHelper.ToEastern(DateTime.UtcNow));

            try
            {
                _logger.LogInformation("Weekly deep refresh starting.");

                using var scope = _scopeFactory.CreateScope();

                var failedSteps = new List<string>();

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
                    failedSteps.Add("teams sync");
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
                    failedSteps.Add("player population + CapFreeze");
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
                    failedSteps.Add("team totals recompute");
                }

                if (failedSteps.Count == 0)
                {
                    _logger.LogInformation("Weekly deep refresh done.");

                    // Mark the weekly job as completed for today ONLY
                    // when every sub-step succeeded. A partial success
                    // is treated as a failure: the flag stays unset, so
                    // the next tick retries with the 10-minute backoff.
                    MarkJobCompleted(JobWeeklyRefresh, completedEtDate);
                }
                else
                {
                    _logger.LogWarning(
                        "Weekly deep refresh finished with {Count} " +
                        "failing step(s): {Steps}. Not marking as " +
                        "completed; will retry with backoff.",
                        failedSteps.Count,
                        string.Join(", ", failedSteps));
                }
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "Weekly deep refresh failed.");
            }
            finally
            {
                ReleaseHeavyLock();
            }
        }

        // =================================================================
        // Jobs 7-9: season reconciliation (safety net for late stat
        // corrections)
        // =================================================================

        /// <summary>
        /// Re-fetches every player's current-season game logs and landing
        /// page, then rebuilds the FantasyTeamSeason totals. Runs three
        /// times a day (05:00, 10:00, 15:00 ET) so any late stat
        /// corrections the NHL makes after a game propagate to every
        /// table on the site.
        ///
        /// The 15:00 ET slot is skipped when any NHL game starts before
        /// 16:00 ET today. Afternoon matinees overlap with the run and
        /// are already handled by the live refresh.
        ///
        /// Uses WaitAsync(0) on the heavy lock: if any other heavy job
        /// is running, this run is skipped and the next tick retries.
        /// The "done" flag is only set AFTER the lock is acquired, so
        /// a skipped run does not mark itself as complete.
        /// </summary>
        private async Task RunSeasonReconciliationAsync(
      string slotLabel,
      string jobName,
      DateOnly todayEt,
      CancellationToken ct)
        {
            if (!await TryAcquireHeavyLockAsync(jobName, ct))
            {
                _logger.LogInformation(
                    "Season reconciliation ({Slot}) skipped: another " +
                    "heavy job is running.",
                    slotLabel);
                return;
            }

            try
            {
                // ---- Afternoon-game check (15:00 ET slot only) --------
                if (slotLabel == "15:00")
                {
                    var hasAfternoonGame =
                        await HasAfternoonNhlGameAsync(todayEt, ct);

                    if (hasAfternoonGame)
                    {
                        _logger.LogInformation(
                            "Season reconciliation (15:00 ET) skipped: " +
                            "afternoon NHL games are scheduled today.");

                        // A skip is a "successful run": mark it done so
                        // we don't retry every tick until tomorrow.
                        MarkJobCompleted(jobName, todayEt);
                        return;
                    }
                }

                using var scope = _scopeFactory.CreateScope();

                var gameLogService = scope.ServiceProvider
                    .GetRequiredService<NhlGameLogService>();

                var seasonCode = await GetCurrentSeasonCodeAsync(scope);

                if (!seasonCode.HasValue)
                {
                    _logger.LogWarning(
                        "Season reconciliation ({Slot}) skipped: no " +
                        "current season.",
                        slotLabel);

                    // No current season is a terminal state for today;
                    // marking it done avoids a retry storm.
                    MarkJobCompleted(jobName, todayEt);
                    return;
                }

                _logger.LogInformation(
                    "Season reconciliation ({Slot}) starting. " +
                    "This can take 30-45 minutes.",
                    slotLabel);

                var result = await gameLogService
                    .RefreshCurrentSeasonForAllPlayersAsync(
                        seasonCode.Value,
                        delayMsBetweenPlayers: 500,
                        skip: 0,
                        take: 0,
                        progress: null,
                        ct);

                // Everything the reconciliation touched is now stale in
                // the read caches. Drop them all.
                _responseCache.Invalidate("standings:");
                _responseCache.Invalidate("roster:");
                _responseCache.Invalidate("player-detail:");
                _responseCache.Invalidate("player-career:");
                _responseCache.Invalidate("league:");

                _logger.LogInformation(
                    "Season reconciliation ({Slot}) done. " +
                    "Players={Players}, GamesSaved={Games}, " +
                    "TeamTotals={Teams} teams / {Credited} games credited, " +
                    "Failed={Failed}.",
                    slotLabel,
                    result.PlayersProcessed,
                    result.TotalGamesSaved,
                    result.TeamTotals?.TeamsProcessed ?? 0,
                    result.TeamTotals?.GamesCredited ?? 0,
                    result.FailedPlayers);

                // Mark done only on successful completion. A failure
                // leaves the flag unset so the next tick retries.
                MarkJobCompleted(jobName, todayEt);
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex, "Season reconciliation ({Slot}) failed.",
                    slotLabel);
            }
            finally
            {
                ReleaseHeavyLock();
            }
        }

        /// <summary>
        /// Returns true when at least one NHL game is scheduled to
        /// start before the afternoon cutoff (16:00 ET) on the given
        /// date. Fails open: if the schedule fetch throws, we assume
        /// no afternoon game and let the reconciliation run, since
        /// running during an afternoon game is harmless (the live
        /// refresh handles the game in parallel).
        /// </summary>
        private async Task<bool> HasAfternoonNhlGameAsync(
            DateOnly todayEt,
            CancellationToken ct)
        {
            try
            {
                using var scope = _scopeFactory.CreateScope();

                var gameService = scope.ServiceProvider
                    .GetRequiredService<NhlGameService>();

                var schedule = await gameService
                    .GetScheduleForDateAsync(todayEt, ct);

                if (schedule.Count == 0)
                {
                    return false;
                }

                foreach (var game in schedule)
                {
                    var startEt = TimeZoneHelper.ToEastern(
                        game.StartTimeUtc);

                    if (startEt.TimeOfDay < AfternoonGameCutoffEt)
                    {
                        return true;
                    }
                }

                return false;
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Could not determine whether afternoon NHL games " +
                    "exist. Proceeding with the 15:00 ET reconciliation.");

                return false;
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