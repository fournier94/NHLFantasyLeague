using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Commissioner-only backup management.
    ///
    /// `list` returns every .dump currently on the server so the admin
    /// can re-download an older one.
    ///
    /// `trigger` runs a fresh pg_dump on demand and returns its
    /// filename. Takes 30–60 s for a typical database. The frontend
    /// uses the returned filename to fire a second request to
    /// `download/{filename}`, so a slow dump and a slow download never
    /// share one HTTP request.
    ///
    /// `download/{filename}` streams the file with a Content-
    /// Disposition: attachment header so the browser saves it instead
    /// of rendering it.
    ///
    /// All three are gated on the Commissioner role. The filename
    /// endpoint is additionally protected against path traversal by
    /// BackupService.ResolveDownloadPath.
    /// </summary>
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class AdminBackupController : ControllerBase
    {
        /// <summary>
        /// How long a backup file stays on disk after a fresh dump is
        /// produced. 7 days is long enough that the admin can download
        /// a copy on their own schedule, and short enough that a
        /// forgotten disk never fills up.
        /// </summary>
        private static readonly TimeSpan Retention =
            TimeSpan.FromDays(7);

        private readonly BackupService _backupService;
        private readonly ILogger<AdminBackupController> _logger;

        public AdminBackupController(
            BackupService backupService,
            ILogger<AdminBackupController> logger)
        {
            _backupService = backupService;
            _logger = logger;
        }

        [HttpGet("list")]
        public IActionResult List()
        {
            return Ok(_backupService.ListBackups());
        }

        [HttpPost("trigger")]
        public async Task<IActionResult> Trigger(
            CancellationToken ct = default)
        {
            try
            {
                var filename = await _backupService.RunDumpAsync(ct);

                _backupService.CleanupOldBackups(Retention);

                return Ok(new { filename });
            }
            catch (Exception ex)
            {
                _logger.LogError(ex, "pg_dump trigger failed.");

                return StatusCode(
                    StatusCodes.Status500InternalServerError,
                    new
                    {
                        message =
                            "La sauvegarde a échoué : " + ex.Message
                    });
            }
        }

        [HttpGet("download/{filename}")]
        public IActionResult Download(string filename)
        {
            var path = _backupService.ResolveDownloadPath(filename);

            if (path == null)
            {
                return NotFound(new
                {
                    message =
                        $"Sauvegarde '{filename}' introuvable."
                });
            }

            // The stream is owned by FileStreamResult and disposed by
            // the framework once the response is fully written.
            var stream = System.IO.File.OpenRead(path);

            return File(
                stream,
                "application/octet-stream",
                fileDownloadName: filename,
                enableRangeProcessing: false);
        }
    }
}