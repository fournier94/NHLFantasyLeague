using System.Collections.Concurrent;

namespace NhlFantasyLeague.api.Services.Jobs
{
    /// <summary>
    /// Shared state for a running background job. The job's work
    /// function receives this and can write progress numbers to it.
    /// The Jobs controller polls this to report status.
    /// </summary>
    public class BackgroundJobContext
    {
        public int ProgressCurrent { get; set; }
        public int ProgressTotal { get; set; }
        public string? Message { get; set; }
        public object? Result { get; set; }
    }

    /// <summary>
    /// In-memory record of one job: id, name, status, result.
    /// </summary>
    public class BackgroundJob
    {
        public string Id { get; set; } = string.Empty;
        public string Name { get; set; } = string.Empty;
        public DateTime StartedAt { get; set; }
        public DateTime? CompletedAt { get; set; }
        public string Status { get; set; } = "Running";
        public string? Error { get; set; }
        public BackgroundJobContext Context { get; set; } = new();
    }

    /// <summary>
    /// Runs long-running operations on a background thread so the
    /// browser gets an immediate response. The work gets its own
    /// service scope (and therefore its own DbContext) so it can
    /// safely run for minutes without a request lifetime.
    /// </summary>
    public class BackgroundJobService
    {
        private readonly ConcurrentDictionary<string, BackgroundJob> _jobs = new();
        private readonly IServiceScopeFactory _scopeFactory;
        private readonly ILogger<BackgroundJobService> _logger;

        public BackgroundJobService(
            IServiceScopeFactory scopeFactory,
            ILogger<BackgroundJobService> logger)
        {
            _scopeFactory = scopeFactory;
            _logger = logger;
        }

        public BackgroundJob Start(
            string name,
            Func<BackgroundJobContext, IServiceProvider, Task> work)
        {
            var id = Guid.NewGuid().ToString("N").Substring(0, 8);

            var job = new BackgroundJob
            {
                Id = id,
                Name = name,
                StartedAt = DateTime.UtcNow,
                Status = "Running"
            };

            _jobs[id] = job;
            _logger.LogInformation("Job {JobId} ({Name}) started", id, name);

            _ = Task.Run(async () =>
            {
                try
                {
                    using var scope = _scopeFactory.CreateScope();
                    await work(job.Context, scope.ServiceProvider);
                    job.Status = "Completed";
                    job.CompletedAt = DateTime.UtcNow;
                    job.Context.Message = "Done.";
                    _logger.LogInformation("Job {JobId} ({Name}) completed", id, name);
                }
                catch (Exception ex)
                {
                    job.Status = "Failed";
                    job.Error = ex.Message;
                    job.CompletedAt = DateTime.UtcNow;
                    job.Context.Message = "Failed.";
                    _logger.LogError(ex, "Job {JobId} ({Name}) failed", id, name);
                }
            });

            // Keep at most 20 jobs in memory.
            if (_jobs.Count > 20)
            {
                var toRemove = _jobs.Values
                    .Where(j => j.Status != "Running")
                    .OrderBy(j => j.StartedAt)
                    .Take(_jobs.Count - 20)
                    .Select(j => j.Id)
                    .ToList();

                foreach (var oldId in toRemove)
                {
                    _jobs.TryRemove(oldId, out _);
                }
            }

            return job;
        }

        public BackgroundJob? Get(string id)
        {
            return _jobs.TryGetValue(id, out var job) ? job : null;
        }

        public IEnumerable<BackgroundJob> GetAll()
        {
            return _jobs.Values.OrderByDescending(j => j.StartedAt);
        }
    }
}