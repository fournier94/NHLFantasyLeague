using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Services.Health
{
    /// <summary>
    /// Tracks the health of every external data source the sync jobs
    /// depend on. One row per source, snapshot only: no history.
    ///
    /// Callers use RecordSuccessAsync / RecordFailureAsync after each
    /// fetch. The admin banner reads the rows via GetAllAsync.
    ///
    /// The known source names are exposed as constants so callers cannot
    /// typo them.
    /// </summary>
    public class ExternalSourceHealthService
    {
        public const string EspnInjuries = "EspnInjuries";
        public const string NhlRosters = "NhlRosters";
        public const string AhlRosters = "AhlRosters";

        private readonly AppDbContext _dbContext;

        public ExternalSourceHealthService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /// <summary>
        /// Marks the source as successfully fetched just now. Resets the
        /// consecutive-failures counter. Does NOT clear LastFailureAt or
        /// LastError, so the admin banner can still show that a failure
        /// happened recently.
        /// </summary>
        public async Task RecordSuccessAsync(
            string sourceName,
            CancellationToken ct = default)
        {
            var row = await EnsureRowAsync(sourceName, ct);

            row.LastSuccessAt = DateTime.UtcNow;
            row.ConsecutiveFailures = 0;

            await _dbContext.SaveChangesAsync(ct);
        }

        /// <summary>
        /// Marks the source as having just failed. Stores the error
        /// message and increments the consecutive-failures counter.
        /// </summary>
        public async Task RecordFailureAsync(
            string sourceName,
            string error,
            CancellationToken ct = default)
        {
            var row = await EnsureRowAsync(sourceName, ct);

            row.LastFailureAt = DateTime.UtcNow;
            row.LastError = Truncate(error, 500);
            row.ConsecutiveFailures++;

            await _dbContext.SaveChangesAsync(ct);
        }

        public async Task<ExternalSourceHealth?> GetAsync(
            string sourceName,
            CancellationToken ct = default)
        {
            return await _dbContext.ExternalSourceHealths
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    h => h.SourceName == sourceName, ct);
        }

        public async Task<List<ExternalSourceHealth>> GetAllAsync(
            CancellationToken ct = default)
        {
            return await _dbContext.ExternalSourceHealths
                .AsNoTracking()
                .OrderBy(h => h.SourceName)
                .ToListAsync(ct);
        }

        private async Task<ExternalSourceHealth> EnsureRowAsync(
            string sourceName,
            CancellationToken ct)
        {
            var row = await _dbContext.ExternalSourceHealths
                .FirstOrDefaultAsync(
                    h => h.SourceName == sourceName, ct);

            if (row == null)
            {
                row = new ExternalSourceHealth
                {
                    SourceName = sourceName
                };

                _dbContext.ExternalSourceHealths.Add(row);
            }

            return row;
        }

        private static string Truncate(string value, int maxLength)
        {
            if (string.IsNullOrEmpty(value) || value.Length <= maxLength)
            {
                return value;
            }

            return value.Substring(0, maxLength);
        }
    }
}