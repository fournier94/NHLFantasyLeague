using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Read and manage the SystemEventLogs table. Commissioner only.
    /// </summary>
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class SystemEventLogController : ControllerBase
    {
        private readonly AppDbContext _db;

        public SystemEventLogController(AppDbContext db)
        {
            _db = db;
        }

        /// <summary>
        /// Returns the most recent events, newest first.
        /// Optional ?severity=Warning|Error to filter.
        /// Optional ?source= prefix filter.
        /// Optional ?limit= (default 100, max 500).
        /// </summary>
        [HttpGet]
        public async Task<IActionResult> Get(
            [FromQuery] string? severity,
            [FromQuery] string? source,
            [FromQuery] int limit = 100,
            CancellationToken ct = default)
        {
            limit = Math.Clamp(limit, 1, 500);

            var q = _db.SystemEventLogs.AsNoTracking().AsQueryable();

            if (!string.IsNullOrWhiteSpace(severity))
            {
                var sev = severity.Trim();
                q = q.Where(e => e.Severity == sev);
            }

            if (!string.IsNullOrWhiteSpace(source))
            {
                var src = source.Trim();
                q = q.Where(e => e.Source.StartsWith(src));
            }

            var rows = await q
                .OrderByDescending(e => e.LastSeenUtc)
                .Take(limit)
                .Select(e => new
                {
                    e.Id,
                    e.TimestampUtc,
                    e.LastSeenUtc,
                    e.Count,
                    e.Source,
                    e.Category,
                    e.Severity,
                    e.Message,
                    e.Details
                })
                .ToListAsync(ct);

            return Ok(rows);
        }

        /// <summary>
        /// Deletes every row in SystemEventLogs. Useful after a fix
        /// is deployed and you want a clean slate.
        /// </summary>
        [HttpDelete]
        public async Task<IActionResult> Clear(CancellationToken ct = default)
        {
            var removed = await _db.SystemEventLogs
                .ExecuteDeleteAsync(ct);

            return Ok(new
            {
                message = $"Deleted {removed} event log row(s).",
                removed
            });
        }
    }
}