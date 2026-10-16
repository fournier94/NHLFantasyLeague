using System.Net;

namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// DelegatingHandler that routes every NHL API call through the
    /// shared NhlApiRateLimiter. Attached to every HttpClient in
    /// Program.cs via ConfigureHttpClientDefaults, so individual
    /// services do not need to know about the limiter.
    ///
    /// SCOPE
    ///
    /// Only requests whose host ends with "nhle.com" go through the
    /// limiter. Non-NHL hosts (capfreeze.com, espn.com,
    /// lscluster.hockeytech.com, etc.) pass straight through, so
    /// their own rate limits and timeouts are unaffected.
    ///
    /// USER-REQUEST BYPASS
    ///
    /// When the current HTTP call is being made on behalf of a user
    /// action, the limiter is skipped. The flag is read from
    /// NhlRequestContext.IsUserRequest, which the middleware in
    /// Program.cs sets to true for the duration of every HTTP
    /// request. Scheduled jobs run on BackgroundService threads
    /// with no HTTP context, so the flag is false for them and
    /// their calls are throttled.
    ///
    /// HANDLER POSITION IN THE PIPELINE
    ///
    /// This handler is registered as the INNERMOST handler on every
    /// HttpClient. It sits between the network and every other
    /// handler. Program.cs registers HttpErrorLoggingHandler first
    /// (outermost) and this handler second (innermost) to guarantee
    /// that the rate limiter's semaphore is held only across the
    /// actual HTTP call, not across the error logger's DB write.
    ///
    /// BODY STREAMING
    ///
    /// All calls in this app use HttpCompletionOption.ResponseContentRead
    /// (the default for GetAsync, GetFromJsonAsync, etc.), which
    /// buffers the entire response body before returning. If a
    /// future call switches to ResponseHeadersRead, the semaphore
    /// could release before the body is fully read.
    /// </summary>
    public class NhlRateLimitHandler : DelegatingHandler
    {
        private readonly NhlApiRateLimiter _limiter;

        public NhlRateLimitHandler(NhlApiRateLimiter limiter)
        {
            _limiter = limiter;
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            if (!IsNhlHost(request.RequestUri))
            {
                return await base.SendAsync(request, cancellationToken);
            }

            // User-initiated requests bypass the limiter entirely.
            //
            // The limiter exists to keep scheduled jobs from
            // exceeding the NHL's 2 req/s ceiling when they overlap.
            // A user expanding one game card makes one or two calls,
            // and there is no reason to slow him down. The user may
            // still trip a 429 in pathological cases, but that is
            // not the rate limiter's concern: the user is not
            // making enough calls to matter, and the response is
            // surfaced normally.
            //
            // The flag is set to true by the middleware in Program.cs
            // for every HTTP request, and is explicitly cleared
            // inside BackgroundJobService.Start so that background
            // jobs started from a controller still go through the
            // limiter.
            if (NhlRequestContext.IsUserRequest)
            {
                return await base.SendAsync(request, cancellationToken);
            }

            return await _limiter.ExecuteAsync(
                async ct =>
                {
                    var response =
                        await base.SendAsync(request, ct);

                    if (response.StatusCode ==
                        HttpStatusCode.TooManyRequests)
                    {
                        _limiter.Record429();
                    }

                    return response;
                },
                cancellationToken);
        }

        /// <summary>
        /// True when the URI points at the NHL API. Both NHL hosts
        /// (api-web.nhle.com and api.nhle.com) end with "nhle.com",
        /// so a single suffix check covers both.
        /// </summary>
        private static bool IsNhlHost(Uri? uri)
        {
            if (uri == null)
            {
                return false;
            }

            return uri.Host.EndsWith(
                "nhle.com",
                StringComparison.OrdinalIgnoreCase);
        }
    }
}