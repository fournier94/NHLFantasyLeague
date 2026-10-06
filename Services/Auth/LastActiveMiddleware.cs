using System.Collections.Concurrent;
using Microsoft.AspNetCore.Identity;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Services.Auth
{
    /// <summary>
    /// Updates <see cref="ApplicationUser.LastActiveAt"/> on every
    /// authenticated API request, throttled to at most one write per
    /// user per <see cref="MinWriteInterval"/>.
    ///
    /// The throttle is an in-memory dictionary keyed by user id. Two
    /// API instances would each maintain their own, which just means
    /// up to 2× the writes — acceptable because the update is a single
    /// column on a table with a handful of rows. The alternative
    /// (reading the row first to check the current value) would add a
    /// DB read to every request, which is worse.
    ///
    /// Runs after UseAuthorization so only requests that got past the
    /// auth pipeline reach it, and after the endpoint returns so the
    /// write never delays the user's response. Failures are swallowed
    /// and logged: a transient DB error must never break a request.
    /// </summary>
    public class LastActiveMiddleware
    {
        /// <summary>
        /// Minimum time between two writes for the same user. 5 minutes
        /// is short enough that the admin view feels accurate and long
        /// enough that a user refreshing the page 20 times a minute
        /// causes one write, not twenty.
        /// </summary>
        private static readonly TimeSpan MinWriteInterval =
            TimeSpan.FromMinutes(5);

        private static readonly ConcurrentDictionary<int, DateTime>
            LastWriteUtcByUserId = new();

        private readonly RequestDelegate _next;
        private readonly ILogger<LastActiveMiddleware> _logger;

        public LastActiveMiddleware(
            RequestDelegate next,
            ILogger<LastActiveMiddleware> logger)
        {
            _next = next;
            _logger = logger;
        }

        public async Task InvokeAsync(
            HttpContext context,
            AppDbContext db,
            UserManager<ApplicationUser> userManager)
        {
            // Run the actual request first. This guarantees the write
            // below never adds latency to the response, and that we
            // only touch the DB after the request has been handled.
            await _next(context);

            // Skip anonymous requests. Only logged-in users have a
            // meaningful "last active".
            if (context.User?.Identity?.IsAuthenticated != true)
            {
                return;
            }

            var userIdString = userManager.GetUserId(context.User);

            if (!int.TryParse(userIdString, out var userId))
            {
                return;
            }

            var now = DateTime.UtcNow;

            // Throttle: if we already wrote within the interval, skip.
            if (LastWriteUtcByUserId.TryGetValue(userId, out var lastWrite)
                && now - lastWrite < MinWriteInterval)
            {
                return;
            }

            // Mark the timestamp BEFORE the DB write so a slow or
            // failing write does not cause a stampede of retries on
            // the very next requests.
            LastWriteUtcByUserId[userId] = now;

            try
            {
                var user = await db.Users.FindAsync(userId);

                if (user == null)
                {
                    return;
                }

                user.LastActiveAt = now;
                await db.SaveChangesAsync();
            }
            catch (Exception ex)
            {
                _logger.LogWarning(
                    ex,
                    "Failed to update LastActiveAt for user {UserId}.",
                    userId);
            }
        }
    }
}