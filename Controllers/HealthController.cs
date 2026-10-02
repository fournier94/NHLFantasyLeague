using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Health;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Reports the current health of every external data source our
    /// sync jobs depend on. Commissioner-only: this drives the admin
    /// banner and is not something league members should need to see.
    ///
    /// Status per source:
    ///   Healthy  - last fetch succeeded, no consecutive failures.
    ///   Degraded - one or two consecutive failures.
    ///   Broken   - three or more consecutive failures.
    ///
    /// The overall status is the worst of all sources.
    /// </summary>
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class HealthController : ControllerBase
    {
        private readonly ExternalSourceHealthService _health;
        private readonly IConfiguration _configuration;

        /// <summary>Number of consecutive failures that flips a source to Broken.</summary>
        private const int BrokenThreshold = 3;

        public HealthController(
            ExternalSourceHealthService health,
            IConfiguration configuration)
        {
            _health = health;
            _configuration = configuration;
        }

        /// <summary>
        /// Returns the health snapshot. Polled by the admin banner on
        /// the frontend; safe to call as often as the SPA wants.
        /// </summary>
        [HttpGet("external-sources")]
        public async Task<IActionResult> GetExternalSourceHealth(
            CancellationToken ct)
        {
            var rows = await _health.GetAllAsync(ct);

            var sources = rows
                .Select(row => new
                {
                    row.SourceName,
                    row.LastSuccessAt,
                    row.LastFailureAt,
                    row.LastError,
                    row.ConsecutiveFailures,
                    Status = ComputeStatus(row.ConsecutiveFailures)
                })
                .ToList();

            var overall = sources.Count == 0
                ? "Healthy"
                : sources
                    .OrderByDescending(s => SeverityOf(s.Status))
                    .First()
                    .Status;

            return Ok(new
            {
                PlayerStatusEnabled = _configuration.GetValue<bool>(
                    "PlayerStatus:Enabled"),
                OverallStatus = overall,
                Sources = sources
            });
        }

        private static string ComputeStatus(int consecutiveFailures)
        {
            if (consecutiveFailures <= 0)
            {
                return "Healthy";
            }

            return consecutiveFailures >= BrokenThreshold
                ? "Broken"
                : "Degraded";
        }

        private static int SeverityOf(string status) => status switch
        {
            "Broken" => 2,
            "Degraded" => 1,
            _ => 0
        };
    }
}