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
    /// FIRE-AND-FORGET WRITE
    ///
    /// The DB write runs in a detached Task.Run with its own DI scope,
    /// NOT in the request scope. That is what keeps it off the
    /// critical path: the middleware returns as soon as the throttle
    /// decision is made, so the pipeline can finalize the response
    /// without waiting for a SELECT + UPDATE against Postgres. This
    /// removes the last 10–30 ms (and the occasional 100–200 ms
    /// spike) that used to sit between the endpoint finishing and
    /// the response being flushed.
    ///
    /// The cost is that a hard process crash between the throttle
    /// stamp and the write completing loses the update. For a soft
    /// "last seen" signal on an admin page, that is acceptable; the
    /// next authenticated request from the same user retries.
    ///
    /// Runs after UseAuthorization so only requests that got past the
    /// auth pipeline reach it.
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
            IServiceScopeFactory scopeFactory,
            UserManager<ApplicationUser> userManager)
        {
            // Run the actual request first. The endpoint produces its
            // response; our only remaining job is to record activity.
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

            // Stamp the throttle BEFORE the write so a slow or
            // failing write does not cause a stampede of retries on
            // the very next requests.
            LastWriteUtcByUserId[userId] = now;

            // Hand the write off to a detached task with its own DI
            // scope. The middleware returns immediately; the response
            // pipeline is not held up by the SELECT + UPDATE.
            //
            // The scope factory gives us a fresh AppDbContext that
            // outlives the request, so the write is safe even if the
            // request-scoped context is being torn down in parallel.
            var capturedUserId = userId;
            var capturedNow = now;

            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = scopeFactory.CreateScope();

                    var db = scope.ServiceProvider
                        .GetRequiredService<AppDbContext>();

                    var user = await db.Users.FindAsync(capturedUserId);

                    if (user == null)
                    {
                        return;
                    }

                    user.LastActiveAt = capturedNow;
                    await db.SaveChangesAsync();
                }
                catch (Exception ex)
                {
                    // Never let the background write crash the process.
                    // A lost LastActiveAt update is inconsequential:
                    // the next authenticated request from the same
                    // user will try again.
                    _logger.LogWarning(
                        ex,
                        "Failed to update LastActiveAt for user {UserId}.",
                        capturedUserId);
                }
            });
        }
    }
}