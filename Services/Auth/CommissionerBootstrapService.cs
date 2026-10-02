using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Services.Auth
{
    /// <summary>
    /// On startup, applies the Commissioner role to every username in
    /// Auth:CommissionerUsernames. Also ensures the Commissioner role
    /// itself exists.
    ///
    /// Runs once at startup. If a username in the config hasn't
    /// registered yet, nothing happens for that name; the next restart
    /// after he registers will grant the role.
    /// </summary>
    public class CommissionerBootstrapService : IHostedService
    {
        private readonly IServiceProvider _serviceProvider;
        private readonly ILogger<CommissionerBootstrapService> _logger;

        public CommissionerBootstrapService(
            IServiceProvider serviceProvider,
            ILogger<CommissionerBootstrapService> logger)
        {
            _serviceProvider = serviceProvider;
            _logger = logger;
        }

        public async Task StartAsync(CancellationToken cancellationToken)
        {
            using var scope = _serviceProvider.CreateScope();

            var authService = scope.ServiceProvider
                .GetRequiredService<AuthService>();

            try
            {
                await authService.EnsureCommissionersAsync(cancellationToken);
                _logger.LogInformation(
                    "Commissioner bootstrap completed.");
            }
            catch (Exception ex)
            {
                _logger.LogError(
                    ex,
                    "Commissioner bootstrap failed. The API will still " +
                    "start; retry by restarting the app.");
            }
        }

        public Task StopAsync(CancellationToken cancellationToken) =>
            Task.CompletedTask;
    }
}