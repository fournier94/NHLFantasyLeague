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
    /// HANDLER POSITION IN THE PIPELINE
    ///
    /// This handler is registered as the INNERMOST handler on every
    /// HttpClient. That means it sits between the network and every
    /// other handler (HttpErrorLoggingHandler, any retry handlers
    /// added later). The semaphore is therefore held only for the
    /// duration of the actual HTTP call, and released before any
    /// downstream handler sees the response.
    ///
    /// Placing this handler OUTERMOST would hold the semaphore while
    /// HttpErrorLoggingHandler writes to the database, which would
    /// let a slow DB stall the entire NHL pipeline. Program.cs
    /// registers HttpErrorLoggingHandler first (outermost) and this
    /// handler second (innermost) to guarantee the correct order.
    ///
    /// BODY STREAMING
    ///
    /// All calls in this app use HttpCompletionOption.ResponseContentRead
    /// (the default for GetAsync, GetFromJsonAsync, etc.), which
    /// buffers the entire response body before returning. That means
    /// the semaphore covers headers + body. If a future call switches
    /// to ResponseHeadersRead, the caller must consume the body
    /// inside the operation passed to ExecuteAsync, otherwise the
    /// semaphore would release while the body is still streaming and
    /// the concurrency guarantee would be broken.
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