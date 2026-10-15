namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// Process-wide rate limiter for every NHL API call.
    ///
    /// WHY THIS EXISTS
    ///
    /// The NHL's public API tolerates roughly 2 requests per second
    /// from a single caller; above that it returns 429 Too Many
    /// Requests. Every service in this app that calls the NHL
    /// (NhlGameService, NhlTeamService, NhlPlayerService,
    /// NhlStatsService, NhlGameLogService, PlayerRosterStatusService)
    /// already paces itself under 2 req/s on its own by inserting a
    /// Task.Delay between calls.
    ///
    /// The problem is overlap. The scheduler runs the live refresh
    /// and the frequent refresh on two independent semaphores, so
    /// they can fire at the same instant. Individually they stay
    /// under 2 req/s; together they can push the aggregate to 2.8+
    /// req/s, which is exactly the burst that produced the 429 storm
    /// on 2026-10-14.
    ///
    /// This limiter is the fix: a single process-wide gate that all
    /// NHL HTTP clients share. It guarantees two invariants:
    ///
    ///   1. At most one NHL HTTP request is in flight at a time.
    ///   2. Consecutive requests are separated by at least
    ///      MinInterval (500 ms by default), so the aggregate rate
    ///      never exceeds 2.0 req/s.
    ///
    /// ADAPTIVE BACKOFF
    ///
    /// 500 ms is exactly the documented ceiling, and the observed
    /// burst ceiling is a little higher. If a 429 does slip through,
    /// the limiter doubles its interval (up to MaxInterval, 5 s)
    /// and keeps it doubled for BackoffResetAfter (60 s) of clean
    /// responses before returning to MinInterval. This makes the
    /// limiter self-tuning: it runs at 500 ms in the common case
    /// and only throttles harder when the NHL tells it to.
    ///
    /// The handler that calls into this limiter records 429s by
    /// invoking Record429(), so the limiter can react without
    /// reaching into the response itself.
    ///
    /// SINGLETON
    ///
    /// Registered as a singleton in Program.cs. The sharing only
    /// works if there is exactly one instance; changing the lifetime
    /// would silently split the meter across HTTP clients and
    /// reintroduce the bug this class was written to fix.
    /// </summary>
    public class NhlApiRateLimiter
    {
        /// <summary>
        /// Minimum gap between two consecutive NHL request starts.
        /// 500 ms = 2 req/s, matching the NHL's published ceiling.
        /// </summary>
        private static readonly TimeSpan MinInterval =
            TimeSpan.FromMilliseconds(500);

        /// <summary>
        /// Hard cap on the adaptive backoff. If even this does not
        /// clear the 429s, the NHL is having a real incident and
        /// the scheduled jobs will just run slower.
        /// </summary>
        private static readonly TimeSpan MaxInterval =
            TimeSpan.FromSeconds(5);

        /// <summary>
        /// How long the limiter must go without seeing a 429 before
        /// it resets the interval back to MinInterval.
        /// </summary>
        private static readonly TimeSpan BackoffResetAfter =
            TimeSpan.FromSeconds(60);

        /// <summary>
        /// Hard ceiling on a single NHL call. If a request hangs,
        /// the semaphore is held only for this long, then the
        /// limiter throws OperationCanceledException back to the
        /// caller (which is normal HttpClient timeout behavior).
        ///
        /// 60 s is generous for the NHL API, whose responses are
        /// normally sub-second. It is tight enough that a batch of
        /// 25 hung calls cannot push the weekly population job
        /// past the 60-minute stuck-lock threshold.
        /// </summary>
        private static readonly TimeSpan PerCallTimeout =
            TimeSpan.FromSeconds(60);

        /// <summary>
        /// The single gate. Held across the entire HTTP call so that
        /// no two NHL requests are ever in flight at once, and so
        /// that a caller who submits many parallel calls queues
        /// behind other callers' single calls.
        /// </summary>
        private readonly SemaphoreSlim _gate = new(1, 1);

        /// <summary>
        /// Guards the adaptive-backoff fields. The gate itself is a
        /// separate concern; these fields are just ints and DateTimes
        /// that must be read/written atomically.
        /// </summary>
        private readonly object _stateLock = new();

        /// <summary>UTC instant the last NHL request started.</summary>
        private DateTime _lastRequestStartUtc = DateTime.MinValue;

        /// <summary>
        /// Current adaptive interval. Starts at MinInterval, doubles
        /// on each 429, resets to MinInterval after BackoffResetAfter
        /// without a 429.
        /// </summary>
        private TimeSpan _currentInterval = MinInterval;

        /// <summary>UTC instant of the most recent observed 429.</summary>
        private DateTime _last429Utc = DateTime.MinValue;

        /// <summary>
        /// Runs one NHL API call through the limiter.
        ///
        /// The operation receives a CancellationToken that fires
        /// either when the caller cancels OR when PerCallTimeout
        /// elapses, whichever comes first. The operation must pass
        /// that token to its HttpClient call so a hung upstream
        /// cannot hold the semaphore past the timeout.
        /// </summary>
        public async Task<T> ExecuteAsync<T>(
            Func<CancellationToken, Task<T>> operation,
            CancellationToken ct = default)
        {
            using var timeoutCts =
                CancellationTokenSource.CreateLinkedTokenSource(ct);

            timeoutCts.CancelAfter(PerCallTimeout);

            await _gate.WaitAsync(timeoutCts.Token);

            try
            {
                var interval = GetCurrentInterval();

                var elapsed = DateTime.UtcNow - _lastRequestStartUtc;
                var wait = interval - elapsed;

                if (wait > TimeSpan.Zero)
                {
                    await Task.Delay(wait, timeoutCts.Token);
                }

                // Set the timestamp BEFORE the request fires, so the
                // interval measures start-to-start, not
                // release-to-start. With the timestamp set after the
                // call, a 400 ms response followed by a 500 ms delay
                // would produce a 900 ms gap (1.1 req/s) instead of
                // the intended 500 ms gap (2.0 req/s).
                _lastRequestStartUtc = DateTime.UtcNow;

                return await operation(timeoutCts.Token);
            }
            finally
            {
                _gate.Release();
            }
        }

        /// <summary>
        /// Records that the most recent call returned 429. Doubles
        /// the current interval, capped at MaxInterval, and stamps
        /// the time so GetCurrentInterval can reset the backoff
        /// once the 429s stop.
        ///
        /// Called by NhlRateLimitHandler after inspecting the
        /// response status code.
        /// </summary>
        public void Record429()
        {
            lock (_stateLock)
            {
                _last429Utc = DateTime.UtcNow;

                var next = TimeSpan.FromMilliseconds(
                    _currentInterval.TotalMilliseconds * 2);

                _currentInterval =
                    next > MaxInterval ? MaxInterval : next;
            }
        }

        /// <summary>
        /// Returns the interval to use for the current call. When
        /// the limiter is in backoff but has not seen a 429 for
        /// BackoffResetAfter, it resets to MinInterval.
        /// </summary>
        private TimeSpan GetCurrentInterval()
        {
            lock (_stateLock)
            {
                if (_currentInterval > MinInterval &&
                    DateTime.UtcNow - _last429Utc > BackoffResetAfter)
                {
                    _currentInterval = MinInterval;
                }

                return _currentInterval;
            }
        }
    }
}