using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Data
{
    /// <summary>
    /// Shared "which season is the current one" resolver.
    ///
    /// This used to be expressed everywhere as
    ///   <c>Seasons.OrderByDescending(s => s.StartDate).First()</c>
    /// which was safe as long as the only season rows in the DB were
    /// past or present. The draft-seeding step now creates future
    /// seasons (2027-2028, etc.) whose StartDate is AFTER the current
    /// season's, and that heuristic silently starts returning those.
    ///
    /// The correct answer is the season whose NhlSeasonCode matches
    /// SeasonCodes.Current. This helper is the single place that
    /// knows that.
    /// </summary>
    public static class SeasonQueries
    {
        public static Task<Season?> GetCurrentSeasonAsync(
            AppDbContext db,
            CancellationToken ct = default)
        {
            var code =
                NhlFantasyLeague.api.Constants.SeasonCodes.Current;

            return db.Seasons
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == code, ct);
        }
    }
}