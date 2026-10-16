namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// Ambient flag that tells the NHL API rate limiter whether the
    /// current HTTP call is being made on behalf of a user action or
    /// by a scheduled background job.
    ///
    /// The rate limiter was added to prevent scheduled jobs from
    /// exceeding the NHL's 2 req/s ceiling when they overlap. A user
    /// expanding one game card makes one or two NHL calls; there is
    /// no reason to slow him down, so user-initiated requests bypass
    /// the limiter entirely.
    ///
    /// IMPLEMENTATION
    ///
    /// AsyncLocal<bool>. The value is set to true by the middleware
    /// registered in Program.cs for the duration of every HTTP
    /// request, and it flows through every async call made from that
    /// request, including any HttpClient call made from a controller
    /// or a service the controller calls.
    ///
    /// Scheduled jobs run from a BackgroundService thread with no
    /// HTTP context, so the flag defaults to false for them and they
    /// always go through the limiter.
    ///
    /// ONE EXCEPTION: BackgroundJobService.Start spawns its work
    /// with Task.Run, which inherits the AsyncLocal value from the
    /// caller (which is the HTTP request thread when the job was
    /// started from a controller). To prevent a user-triggered
    /// background job from bypassing the limiter, that method
    /// explicitly clears the flag at the top of its task. See
    /// BackgroundJobService.Start for the exact line.
    /// </summary>
    public static class NhlRequestContext
    {
        private static readonly AsyncLocal<bool> _isUserRequest = new();

        public static bool IsUserRequest
        {
            get => _isUserRequest.Value;
            set => _isUserRequest.Value = value;
        }
    }
}