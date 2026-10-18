using System.Diagnostics;
using Microsoft.Extensions.Configuration;
using Microsoft.Extensions.Logging;
using Npgsql;

namespace NhlFantasyLeague.api.Services
{
    /// <summary>
    /// Runs pg_dump against the app's database and manages the on-disk
    /// backup directory. The commissioner-triggered download endpoint
    /// uses this to produce a fresh backup on demand.
    ///
    /// The file format is pg_dump custom (compressed binary, -Fc), the
    /// same format `pg_restore` consumes. It carries schema, data,
    /// indexes, constraints and sequence state, so a restore produces
    /// a byte-identical database (modulo any migrations that ran since
    /// the dump was taken, which Program.cs applies on startup).
    ///
    /// This service does NOT do scheduled backups. Those are handled
    /// by a host-level cron job outside this app. The point of this
    /// service is the admin's escape hatch: "give me a copy right now
    /// so I can keep it off the VPS".
    /// </summary>
    public class BackupService
    {
        /// <summary>
        /// Strict filename pattern. Anything that does not match is
        /// rejected outright, which is the first of two path-traversal
        /// guards (the second is the StartsWith check in
        /// ResolveDownloadPath).
        /// </summary>
        private static readonly System.Text.RegularExpressions.Regex FilenameRegex =
            new(
                @"^nhlfantasy-\d{8}-\d{6}-\d+\.dump$",
                System.Text.RegularExpressions.RegexOptions.Compiled);

        private readonly IConfiguration _configuration;
        private readonly ILogger<BackupService> _logger;
        private readonly string _backupDirectory;

        public BackupService(
            IConfiguration configuration,
            ILogger<BackupService> logger)
        {
            _configuration = configuration;
            _logger = logger;
            _backupDirectory =
                configuration["Backup:Directory"] ?? "/backups";
        }

        /// <summary>Directory the backups live in. Exposed for diagnostics.</summary>
        public string BackupDirectory => _backupDirectory;

        /// <summary>
        /// Runs pg_dump and writes a fresh .dump file to the backup
        /// directory. Returns the generated filename. Cancels if the
        /// caller's request is aborted; the temp file is cleaned up.
        /// </summary>
        public async Task<string> RunDumpAsync(
            CancellationToken ct = default)
        {
            Directory.CreateDirectory(_backupDirectory);

            var cs = new NpgsqlConnectionStringBuilder(
                _configuration.GetConnectionString("DefaultConnection"));

            if (string.IsNullOrWhiteSpace(cs.Host) ||
                string.IsNullOrWhiteSpace(cs.Username) ||
                string.IsNullOrWhiteSpace(cs.Database))
            {
                throw new InvalidOperationException(
                    "Database connection string is missing required " +
                    "components (Host, Username or Database).");
            }

            var timestamp = DateTime.UtcNow.ToString("yyyyMMdd-HHmmss");

            // ProcessId in the filename disambiguates two dumps that
            // somehow land in the same second (e.g. a stuck retry).
            var filename =
                $"nhlfantasy-{timestamp}-{Environment.ProcessId}.dump";

            var filepath = Path.Combine(_backupDirectory, filename);
            var tempPath = filepath + ".tmp";

            var psi = new ProcessStartInfo
            {
                FileName = "pg_dump",
                RedirectStandardOutput = true,
                RedirectStandardError = true,
                UseShellExecute = false,
                CreateNoWindow = true,
            };

            psi.ArgumentList.Add("-h");
            psi.ArgumentList.Add(cs.Host);

            psi.ArgumentList.Add("-p");
            psi.ArgumentList.Add(cs.Port.ToString());

            psi.ArgumentList.Add("-U");
            psi.ArgumentList.Add(cs.Username);

            psi.ArgumentList.Add("-d");
            psi.ArgumentList.Add(cs.Database);

            // Custom format (compressed, restorable with pg_restore,
            // supports selective restore). -Z 9 is maximum compression.
            psi.ArgumentList.Add("-Fc");
            psi.ArgumentList.Add("-Z");
            psi.ArgumentList.Add("9");

            // Never pass the password on the command line: it would be
            // visible in `ps aux`. PGPASSWORD is the standard mechanism.
            psi.Environment["PGPASSWORD"] = cs.Password ?? string.Empty;

            _logger.LogInformation(
                "pg_dump starting: host={Host}, db={Database}, " +
                "target={Output}",
                cs.Host, cs.Database, filepath);

            try
            {
                using var process = Process.Start(psi);

                if (process == null)
                {
                    throw new InvalidOperationException(
                        "Failed to start the pg_dump process.");
                }

                // stderr must be consumed CONCURRENTLY with stdout, or a
                // long warning stream can fill the pipe buffer and block
                // pg_dump forever. The task-based read is the standard
                // way to prevent that.
                var stderrTask = process.StandardError.ReadToEndAsync();

                using (var fileStream = File.Create(tempPath))
                {
                    await process.StandardOutput.BaseStream
                        .CopyToAsync(fileStream, ct);
                }

                var stderr = await stderrTask;

                await process.WaitForExitAsync(ct);

                if (process.ExitCode != 0)
                {
                    try { File.Delete(tempPath); } catch { }

                    throw new InvalidOperationException(
                        $"pg_dump exited with code {process.ExitCode}. " +
                        $"stderr: {stderr}");
                }

                // Atomic promotion: the .tmp file only becomes the
                // canonical .dump after pg_dump exits cleanly, so a
                // half-written dump is never visible to ListBackups.
                File.Move(tempPath, filepath, overwrite: true);

                var size = new FileInfo(filepath).Length;

                _logger.LogInformation(
                    "pg_dump complete: {Filename} ({Bytes} bytes)",
                    filename, size);

                return filename;
            }
            catch
            {
                try
                {
                    if (File.Exists(tempPath)) File.Delete(tempPath);
                }
                catch
                {
                    // Never let cleanup failure mask the real error.
                }

                throw;
            }
        }

        /// <summary>
        /// Lists every .dump file currently in the backup directory,
        /// newest first. Only files that match the strict filename
        /// pattern are returned, so anything the admin manually copies
        /// into the directory with a different name is ignored.
        /// </summary>
        public List<BackupFileInfo> ListBackups()
        {
            if (!Directory.Exists(_backupDirectory))
            {
                return new List<BackupFileInfo>();
            }

            return Directory
                .GetFiles(_backupDirectory, "nhlfantasy-*.dump")
                .Select(path => new FileInfo(path))
                .Where(fi => FilenameRegex.IsMatch(fi.Name))
                .OrderByDescending(fi => fi.CreationTimeUtc)
                .Select(fi => new BackupFileInfo
                {
                    Filename = fi.Name,
                    SizeBytes = fi.Length,
                    CreatedAtUtc = fi.CreationTimeUtc,
                })
                .ToList();
        }

        /// <summary>
        /// Resolves a filename to an absolute path that is guaranteed
        /// to be inside the backup directory, or returns null when the
        /// file is missing or the filename is invalid. Used by the
        /// download endpoint so a crafted filename like
        /// "../../etc/passwd" cannot escape.
        /// </summary>
        public string? ResolveDownloadPath(string filename)
        {
            if (string.IsNullOrWhiteSpace(filename) ||
                !FilenameRegex.IsMatch(filename))
            {
                return null;
            }

            var normalizedDir = Path.GetFullPath(_backupDirectory)
                .TrimEnd(Path.DirectorySeparatorChar)
                + Path.DirectorySeparatorChar;

            var normalizedFile = Path.GetFullPath(
                Path.Combine(_backupDirectory, filename));

            if (!normalizedFile.StartsWith(
                    normalizedDir, StringComparison.Ordinal))
            {
                return null;
            }

            return File.Exists(normalizedFile) ? normalizedFile : null;
        }

        /// <summary>
        /// Deletes .dump files older than the given retention window.
        /// Called after every fresh dump so the directory never grows
        /// unbounded even if the admin triggers many backups in a day.
        /// </summary>
        public void CleanupOldBackups(TimeSpan retention)
        {
            if (!Directory.Exists(_backupDirectory)) return;

            var cutoff = DateTime.UtcNow - retention;
            var removed = 0;

            foreach (var path in Directory.GetFiles(
                _backupDirectory, "nhlfantasy-*.dump"))
            {
                try
                {
                    var fi = new FileInfo(path);

                    if (fi.CreationTimeUtc < cutoff &&
                        FilenameRegex.IsMatch(fi.Name))
                    {
                        fi.Delete();
                        removed++;
                    }
                }
                catch (Exception ex)
                {
                    _logger.LogWarning(
                        ex,
                        "Failed to delete old backup {Path}.", path);
                }
            }

            if (removed > 0)
            {
                _logger.LogInformation(
                    "Cleaned up {Count} old backup file(s).", removed);
            }
        }
    }

    /// <summary>One row of the backup list, as returned to the admin page.</summary>
    public class BackupFileInfo
    {
        public string Filename { get; set; } = string.Empty;
        public long SizeBytes { get; set; }
        public DateTime CreatedAtUtc { get; set; }
    }
}