using NhlFantasyLeague.api.Services.Logging;

namespace NhlFantasyLeague.api.Services.Logging
{
    /// <summary>
    /// Intercepts every HTTP call made by our HttpClient instances
    /// and records non-2xx responses and transport failures to
    /// SystemEventLogs. Wired up in Program.cs via
    /// ConfigureHttpClientDefaults.
    ///
    /// The handler never throws on log failures and never modifies
    /// the response — it observes and passes through.
    /// </summary>
    public class HttpErrorLoggingHandler : DelegatingHandler
    {
        private readonly IServiceScopeFactory _scopeFactory;

        public HttpErrorLoggingHandler(IServiceScopeFactory scopeFactory)
        {
            _scopeFactory = scopeFactory;
        }

        protected override async Task<HttpResponseMessage> SendAsync(
            HttpRequestMessage request,
            CancellationToken cancellationToken)
        {
            try
            {
                var response = await base.SendAsync(request, cancellationToken);

                if (!response.IsSuccessStatusCode)
                {
                    await LogAsync(
                        request,
                        statusCode: (int)response.StatusCode,
                        reason: response.ReasonPhrase,
                        exception: null);
                }

                return response;
            }
            catch (Exception ex) when (
                ex is HttpRequestException ||
                ex is TaskCanceledException ||
                ex is OperationCanceledException)
            {
                await LogAsync(
                    request,
                    statusCode: 0,
                    reason: null,
                    exception: ex);
                throw;
            }
        }

        private async Task LogAsync(
            HttpRequestMessage request,
            int statusCode,
            string? reason,
            Exception? exception)
        {
            try
            {
                var host = request.RequestUri?.Host ?? "unknown";

                var source = host switch
                {
                    var h when h.Contains("nhle.com") => "NhlApi",
                    var h when h.Contains("espn.com") => "EspnApi",
                    var h when h.Contains("capfreeze.com") => "CapFreeze",
                    var h when h.Contains("hockeytech.com") => "AhlFeed",
                    _ => host
                };

                var category = statusCode == 0
                    ? "HttpTransportFailure"
                    : $"Http{statusCode}";

                var severity = statusCode == 429
                    ? "Warning"
                    : "Error";

                var path = request.RequestUri?.PathAndQuery ?? string.Empty;

                var message = statusCode == 0
                    ? $"{exception!.GetType().Name} on {request.Method} {path}"
                    : $"{statusCode} {reason ?? string.Empty} on {request.Method} {path}";

                var details = exception != null
                    ? $"{exception.GetType().Name}: {exception.Message}"
                    : null;

                using var scope = _scopeFactory.CreateScope();
                var log = scope.ServiceProvider
                    .GetRequiredService<SystemEventLogService>();

                await log.RecordAsync(
                    source: source,
                    category: category,
                    severity: severity,
                    message: message,
                    details: details);
            }
            catch
            {
                // Never let logging failures propagate.
            }
        }
    }
}