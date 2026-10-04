using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services.Jobs;
using NhlFantasyLeague.api.Services.NHL;
using NhlFantasyLeague.api.Services.Health;

namespace NhlFantasyLeague.api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class JobsController : ControllerBase
    {
        private readonly BackgroundJobService _jobs;

        public JobsController(BackgroundJobService jobs)
        {
            _jobs = jobs;
        }

        // --------------------------------------------------------------
        // Start endpoints — each returns immediately with a jobId.
        // --------------------------------------------------------------

        [HttpPost("refresh-all/start")]
        public IActionResult StartRefreshAll(
            [FromQuery] int seasonCode = 20262027,
            [FromQuery] int delayMsBetweenPlayers = 100)
        {
            var job = _jobs.Start("refresh-all", async (ctx, sp) =>
            {
                var svc = sp.GetRequiredService<NhlGameLogService>();
                ctx.Message = "Refreshing game logs and season stats...";

                var result = await svc.RefreshCurrentSeasonForAllPlayersAsync(
                    seasonCode,
                    delayMsBetweenPlayers,
                    0, 0,
                    ctx,
                    CancellationToken.None);

                ctx.Result = result;
            });

            return Ok(new
            {
                jobId = job.Id,
                name = job.Name,
                startedAt = job.StartedAt,
                message = "Job started. Poll GET /api/Jobs/{jobId} for progress."
            });
        }

        [HttpPost("player-roster-status/start")]
        public IActionResult StartPlayerRosterStatus()
        {
            var job = _jobs.Start("player-roster-status", async (ctx, sp) =>
            {
                var svc = sp.GetRequiredService<PlayerRosterStatusService>();
                ctx.Message = "Refreshing roster locations...";

                var result = await svc.RefreshAsync(
                    ctx,
                    CancellationToken.None);

                ctx.Result = result;
            });

            return Ok(new
            {
                jobId = job.Id,
                name = job.Name,
                startedAt = job.StartedAt,
                message = "Job started. Poll GET /api/Jobs/{jobId} for progress."
            });
        }

        [HttpPost("career-hat-tricks/start")]
        public IActionResult StartCareerHatTricks(
            [FromQuery] int delayMsBetweenCalls = 200,
            [FromQuery] bool force = false)
        {
            var job = _jobs.Start("career-hat-tricks", async (ctx, sp) =>
            {
                var svc = sp.GetRequiredService<NhlStatsService>();
                ctx.Message = "Backfilling career hat tricks...";

                var result = await svc.BackfillCareerHatTricksAsync(
                    delayMsBetweenCalls,
                    force,
                    ctx,
                    CancellationToken.None);

                ctx.Result = result;
            });

            return Ok(new
            {
                jobId = job.Id,
                name = job.Name,
                startedAt = job.StartedAt,
                message = "Job started. Poll GET /api/Jobs/{jobId} for progress."
            });
        }

        // --------------------------------------------------------------
        // Status endpoints
        // --------------------------------------------------------------

        [HttpGet("{id}")]
        public IActionResult GetStatus(string id)
        {
            var job = _jobs.Get(id);

            if (job == null)
            {
                return NotFound(new { message = $"Job '{id}' not found." });
            }

            return Ok(new
            {
                job.Id,
                job.Name,
                job.Status,
                job.StartedAt,
                job.CompletedAt,
                job.Error,
                Message = job.Context.Message,
                ProgressCurrent = job.Context.ProgressCurrent,
                ProgressTotal = job.Context.ProgressTotal,
                Result = job.Context.Result
            });
        }

        [HttpGet]
        public IActionResult List()
        {
            return Ok(_jobs.GetAll().Select(j => new
            {
                j.Id,
                j.Name,
                j.Status,
                j.StartedAt,
                j.CompletedAt,
                j.Error,
                Message = j.Context.Message,
                ProgressCurrent = j.Context.ProgressCurrent,
                ProgressTotal = j.Context.ProgressTotal
            }));
        }
    }
}