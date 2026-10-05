using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Jobs;
using NhlFantasyLeague.api.Services.NHL;
using NhlFantasyLeague.api.Services.Health;

namespace NhlFantasyLeague.api.Controllers
{
    [Authorize(Roles = AuthService.CommissionerRole)]
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
            [FromQuery] int delayMsBetweenPlayers = 500)
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
            [FromQuery] int delayMsBetweenCalls = 500,
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

        /// <summary>
        /// Runs the entire NHL-data refresh pipeline in one shot, in a
        /// fixed order. Each step is best-effort: if one fails, the
        /// remaining steps still run so a partial rebuild is possible.
        /// The job's Result contains a per-step status report.
        ///
        /// Steps:
        ///   1. League setup               (League + Seasons + FantasyTeams)
        ///   2. Sync NHL teams             (32 teams)
        ///   3. Populate player database   (discovery + landing + CapFreeze)
        ///   4. Refresh game logs          (PlayerGameLog + PlayerSeasonStat + FP)
        ///   5. Refresh injuries           (ESPN)
        ///   6. Refresh roster status      (NHL/AHL/Injured)
        ///   7. Backfill career hat tricks (PlayerCareerStat.HatTricks)
        ///
        /// Does NOT touch RosterEntries (fantasy team assignments) or
        /// AspNetUsers (accounts). Restore those separately from your
        /// SQL backup before running this job if you're rebuilding
        /// from scratch.
        /// </summary>
        [HttpPost("refresh-everything/start")]
        public IActionResult StartRefreshEverything(
            [FromQuery] int seasonCode = 20262027,
            [FromQuery] int delayMsBetweenPlayers = 500,
            [FromQuery] int delayMsBetweenCalls = 500)
        {
            var job = _jobs.Start("refresh-everything", async (ctx, sp) =>
            {
                var steps = new List<object>();
                Exception? firstError = null;

                async Task RunStep(string name, Func<Task<object?>> step)
                {
                    ctx.Message = name;
                    try
                    {
                        var r = await step();
                        steps.Add(new { step = name, status = "OK", result = r });
                    }
                    catch (Exception ex)
                    {
                        steps.Add(new
                        {
                            step = name,
                            status = "FAILED",
                            error = $"{ex.GetType().Name}: {ex.Message}"
                        });
                        firstError ??= ex;
                    }
                }

                // 1. League setup — idempotent. Creates anything missing.
                await RunStep("League setup", async () =>
                {
                    var svc = sp.GetRequiredService<LeagueSetupService>();
                    return await svc.SetupLeagueAsync();
                });

                // 2. Sync NHL teams.
                await RunStep("Sync NHL teams", async () =>
                {
                    var svc = sp.GetRequiredService<NhlTeamService>();
                    var teams = await svc.SyncTeamsAsync();
                    return new { count = teams.Count };
                });

                // 3. Populate player database.
                //    Internally: discovery → landing → CapFreeze sync.
                await RunStep("Populate player database", async () =>
                {
                    var svc = sp.GetRequiredService<NhlPopulationService>();
                    return await svc.PopulateEntirePlayerDatabaseAsync();
                });

                // 4. Refresh game logs + season stats + FP + team totals.
                await RunStep("Refresh game logs", async () =>
                {
                    var svc = sp.GetRequiredService<NhlGameLogService>();
                    return await svc.RefreshCurrentSeasonForAllPlayersAsync(
                        seasonCode,
                        delayMsBetweenPlayers,
                        0, 0,
                        ctx,
                        CancellationToken.None);
                });

                // 5. Refresh injuries from ESPN.
                await RunStep("Refresh injuries", async () =>
                {
                    var svc = sp.GetRequiredService<NhlInjuryService>();
                    return await svc.RefreshAsync(CancellationToken.None);
                });

                // 6. Refresh roster locations.
                await RunStep("Refresh roster status", async () =>
                {
                    var svc = sp.GetRequiredService<PlayerRosterStatusService>();
                    return await svc.RefreshAsync(null, CancellationToken.None);
                });

                // 7. Backfill career hat tricks.
                await RunStep("Backfill career hat tricks", async () =>
                {
                    var svc = sp.GetRequiredService<NhlStatsService>();
                    return await svc.BackfillCareerHatTricksAsync(
                        delayMsBetweenCalls,
                        false,
                        null,
                        CancellationToken.None);
                });

                ctx.Result = new
                {
                    seasonCode,
                    steps,
                    firstError = firstError?.Message
                };

                if (firstError != null)
                {
                    throw firstError;
                }
            });

            return Ok(new
            {
                jobId = job.Id,
                name = job.Name,
                startedAt = job.StartedAt,
                message =
                    "Full pipeline job started. " +
                    "Poll GET /api/Jobs/{jobId} for progress."
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