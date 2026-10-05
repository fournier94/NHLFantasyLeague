using System.Security.Cryptography;
using System.Text;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Services.Logging
{
    /// <summary>
    /// Records errors and warnings into the SystemEventLogs table.
    ///
    /// Dedupes by (Source, Category, Message): if an identical event
    /// fired within DedupeWindow, we increment Count and bump
    /// LastSeenUtc on the existing row instead of inserting.
    ///
    /// Also prunes old rows (CleanupAsync) so the table never grows
    /// unbounded.
    /// </summary>
    public class SystemEventLogService
    {
        /// <summary>Identical events within this window fold into
        /// one row.</summary>
        private static readonly TimeSpan DedupeWindow =
            TimeSpan.FromSeconds(60);

        /// <summary>Retention: rows older than this are deleted by
        /// the daily cleanup.</summary>
        private static readonly TimeSpan MaxAge =
            TimeSpan.FromDays(30);

        /// <summary>Hard cap on total rows. Oldest are pruned first.</summary>
        private const int MaxRows = 5000;

        private readonly AppDbContext _db;
        private readonly ILogger<SystemEventLogService> _logger;

        public SystemEventLogService(
            AppDbContext db,
            ILogger<SystemEventLogService> logger)
        {
            _db = db;
            _logger = logger;
        }

        public async Task RecordAsync(
            string source,
            string category,
            string severity,
            string message,
            string? details = null,
            CancellationToken ct = default)
        {
            try
            {
                var now = DateTime.UtcNow;
                var dedupeKey = ComputeDedupeKey(source, category, message);

                // Dedup check: look for a recent row with the same key.
                var cutoff = now - DedupeWindow;

                var existing = await _db.SystemEventLogs
                    .Where(e =>
                        e.DedupeKey == dedupeKey &&
                        e.LastSeenUtc >= cutoff)
                    .OrderByDescending(e => e.LastSeenUtc)
                    .FirstOrDefaultAsync(ct);

                if (existing != null)
                {
                    existing.Count += 1;
                    existing.LastSeenUtc = now;
                    await _db.SaveChangesAsync(ct);
                    return;
                }

                var entry = new SystemEventLog
                {
                    TimestampUtc = now,
                    LastSeenUtc = now,
                    Count = 1,
                    Source = Truncate(source, 100),
                    Category = Truncate(category, 50),
                    Severity = Truncate(severity, 20),
                    Message = Truncate(message, 500),
                    Details = details == null ? null : Truncate(details, 2000),
                    DedupeKey = dedupeKey
                };

                _db.SystemEventLogs.Add(entry);
                await _db.SaveChangesAsync(ct);
            }
            catch (Exception ex)
            {
                // Never let logging failures cascade into the caller.
                _logger.LogWarning(
                    ex, "Failed to record system event log entry.");
            }
        }

        public async Task CleanupAsync(CancellationToken ct = default)
        {
            try
            {
                var ageCutoff = DateTime.UtcNow - MaxAge;

                var removedByAge = await _db.SystemEventLogs
                    .Where(e => e.LastSeenUtc < ageCutoff)
                    .ExecuteDeleteAsync(ct);

                var total = await _db.SystemEventLogs.CountAsync(ct);

                var removedByCap = 0;

                if (total > MaxRows)
                {
                    var excess = total - MaxRows;

                    var idsToDelete = await _db.SystemEventLogs
                        .OrderBy(e => e.LastSeenUtc)
                        .Take(excess)
                        .Select(e => e.Id)
                        .ToListAsync(ct);

                    removedByCap = await _db.SystemEventLogs
                        .Where(e => idsToDelete.Contains(e.Id))
                        .ExecuteDeleteAsync(ct);
                }

                if (removedByAge > 0 || removedByCap > 0)
                {
                    _logger.LogInformation(
                        "SystemEventLog cleanup: removed {Age} by age, " +
                        "{Cap} by cap.",
                        removedByAge, removedByCap);
                }
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex, "SystemEventLog cleanup failed.");
            }
        }

        private static string ComputeDedupeKey(
            string source,
            string category,
            string message)
        {
            var raw = $"{source}|{category}|{message}";
            var bytes = SHA256.HashData(Encoding.UTF8.GetBytes(raw));
            return Convert.ToHexString(bytes).ToLowerInvariant();
        }

        private static string Truncate(string value, int max)
        {
            if (string.IsNullOrEmpty(value)) return value ?? string.Empty;
            return value.Length <= max ? value : value.Substring(0, max);
        }
    }
}