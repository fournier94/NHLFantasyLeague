using Microsoft.Extensions.Hosting;
using Microsoft.Extensions.Logging;

namespace NhlFantasyLeague.api.Services.Jobs
{
    /// <summary>
    /// Runs the scheduler. Every 30 seconds it calls
    /// ScheduledJobsRunner.TickAsync, which decides whether any of the
    /// four jobs are due right now.
    ///
    /// 30 seconds is a cheap interval: the tick only reads local time
    /// and calls into the runner, which returns immediately if no job
    /// is due. No DB access, no HTTP calls, no timers to leak.
    /// </summary>
    public class ScheduledJobsHostedService : BackgroundService
    {
        private static readonly TimeSpan TickInterval =
            TimeSpan.FromSeconds(30);

        private readonly ScheduledJobsRunner _runner;
        private readonly ILogger<ScheduledJobsHostedService> _logger;

        public ScheduledJobsHostedService(
            ScheduledJobsRunner runner,
            ILogger<ScheduledJobsHostedService> logger)
        {
            _runner = runner;
            _logger = logger;
        }

        protected override async Task ExecuteAsync(CancellationToken stoppingToken)
        {
            _logger.LogInformation(
                "Scheduled jobs hosted service started.");

            // Small startup delay so the app finishes warming up
            // (migrations, first requests) before we start firing
            // ticks.
            try
            {
                await Task.Delay(TimeSpan.FromSeconds(15), stoppingToken);
            }
            catch (TaskCanceledException)
            {
                return;
            }

            while (!stoppingToken.IsCancellationRequested)
            {
                try
                {
                    await _runner.TickAsync(stoppingToken);
                }
                catch (TaskCanceledException)
                {
                    // Shutting down.
                    break;
                }
                catch (Exception ex)
                {
                    // A failure inside the tick must never kill the
                    // loop. Log it and try again next interval.
                    _logger.LogError(
                        ex, "Scheduled jobs tick threw.");
                }

                try
                {
                    await Task.Delay(TickInterval, stoppingToken);
                }
                catch (TaskCanceledException)
                {
                    break;
                }
            }

            _logger.LogInformation(
                "Scheduled jobs hosted service stopped.");
        }
    }
}