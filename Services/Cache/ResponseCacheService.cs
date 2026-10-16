using System.Collections.Concurrent;
using Microsoft.Extensions.Logging;

namespace NhlFantasyLeague.api.Services.Cache
{
    /// <summary>
    /// Simple in-memory response cache for read-heavy GET endpoints.
    ///
    /// WHY THIS EXISTS
    ///
    /// Neon bills compute time. Every DB query wakes the compute for
    /// 5 minutes, and we have a 100 CU-hour/month budget. User traffic
    /// is the largest cost driver: 12 DGs each loading /mon-equipe and
    /// /classement several times a day adds up.
    ///
    /// This cache short-circuits the queries themselves, so repeated
    /// hits within the TTL never touch the DB at all. A handful of
    /// users loading the standings page in the same 30-second window
    /// triggers one DB wake-up instead of ten.
    ///
    /// DESIGN
    ///
    ///   - Entries are keyed by a caller-supplied string. Prefixes are
    ///     conventional: "standings:", "roster:", "league:".
    ///
    ///   - Invalidate(prefix) drops every entry whose key starts with
    ///     the prefix. Used by roster mutations (which change both
    ///     roster and standings data) and by the post-game write /
    ///     recompute.
    ///
    ///   - ConcurrentDictionary so multiple request threads never
    ///     corrupt state. Reads are lock-free.
    ///
    ///   - No eviction policy. The entry count is tiny (a few dozen at
    ///     most) and each entry has a TTL, so memory is bounded.
    /// </summary>
    public class ResponseCacheService
    {
        private readonly ConcurrentDictionary<string, CacheEntry> _entries = new();
        private readonly ILogger<ResponseCacheService> _logger;

        public ResponseCacheService(ILogger<ResponseCacheService> logger)
        {
            _logger = logger;
        }

        private sealed class CacheEntry
        {
            public object Value { get; init; } = null!;
            public DateTime ExpiresAtUtc { get; init; }
        }

        /// <summary>
        /// Returns the cached value for the key if it exists and has
        /// not expired; otherwise runs the factory, caches the result,
        /// and returns it.
        ///
        /// The factory runs OUTSIDE any lock. If two callers miss at
        /// the same instant, both run the factory and the second write
        /// wins. That is acceptable: the queries are idempotent and
        /// the cost of a duplicate DB read is negligible compared to
        /// the cost of serializing all requests behind a lock.
        ///
        /// Null results from the factory are NOT cached. This matters
        /// for endpoints whose factory can transiently return null
        /// (e.g. an NHL API fetch that failed): caching a null would
        /// lock the caller out of the endpoint for the full TTL.
        /// </summary>
        public async Task<T> GetOrCreateAsync<T>(
            string key,
            TimeSpan ttl,
            Func<Task<T>> factory)
            where T : class
        {
            if (_entries.TryGetValue(key, out var existing) &&
                DateTime.UtcNow < existing.ExpiresAtUtc &&
                existing.Value is T cached)
            {
                return cached;
            }

            var value = await factory();

            // Do not cache nulls. A transient failure should not lock
            // the caller out of the endpoint for the TTL duration.
            if (value == null)
            {
                return null!;
            }

            _entries[key] = new CacheEntry
            {
                Value = value,
                ExpiresAtUtc = DateTime.UtcNow + ttl,
            };

            return value;
        }

        /// <summary>
        /// Returns the cached value for the key if it exists and has
        /// not expired, otherwise null. Non-generic callers use this
        /// when they want to make their own caching decision (e.g.
        /// only cache FINAL games, not LIVE ones).
        /// </summary>
        public T? TryGet<T>(string key)
            where T : class
        {
            if (_entries.TryGetValue(key, out var existing) &&
                DateTime.UtcNow < existing.ExpiresAtUtc &&
                existing.Value is T cached)
            {
                return cached;
            }

            return null;
        }

        /// <summary>
        /// Stores the value for the key with the given TTL. Used by
        /// endpoints whose caching policy depends on the payload
        /// (e.g. only cache FINAL boxscores, skip LIVE ones), where a
        /// single GetOrCreateAsync call cannot express the rule.
        ///
        /// Null values are silently ignored.
        /// </summary>
        public void Set<T>(string key, T value, TimeSpan ttl)
            where T : class
        {
            if (value == null)
            {
                return;
            }

            _entries[key] = new CacheEntry
            {
                Value = value,
                ExpiresAtUtc = DateTime.UtcNow + ttl,
            };
        }

        /// <summary>
        /// Removes every entry whose key starts with the given prefix.
        /// </summary>
        public void Invalidate(string prefix)
        {
            var removed = 0;

            foreach (var key in _entries.Keys)
            {
                if (key.StartsWith(prefix, StringComparison.Ordinal) &&
                    _entries.TryRemove(key, out _))
                {
                    removed++;
                }
            }

            if (removed > 0)
            {
                _logger.LogInformation(
                    "Response cache: removed {Count} entr(ies) " +
                    "with prefix '{Prefix}'.",
                    removed, prefix);
            }
        }
    }
}