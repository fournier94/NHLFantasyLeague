using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.Jobs;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers
{
    [ApiController]
    [Route("api/[controller]")]
    public class GamesController : ControllerBase
    {
        private static readonly TimeSpan CacheFreshnessWindow =
            TimeSpan.FromMinutes(10);

        private static readonly TimeSpan TeamLookupTtl =
            TimeSpan.FromMinutes(5);

        private static readonly string TeamLookupCacheKey =
            "gameday:team-lookup";

        private static readonly TimeSpan FinalBoxscoreTtl =
            TimeSpan.FromMinutes(10);

        private static readonly TimeSpan ByDateScheduleTtl =
            TimeSpan.FromMinutes(5);

        private readonly LiveGameCache _cache;
        private readonly ScheduledJobsRunner _runner;
        private readonly NhlGameService _gameService;
        private readonly AppDbContext _dbContext;
        private readonly ResponseCacheService _responseCache;

        public GamesController(
            LiveGameCache cache,
            ScheduledJobsRunner runner,
            NhlGameService gameService,
            AppDbContext dbContext,
            ResponseCacheService responseCache)
        {
            _cache = cache;
            _runner = runner;
            _gameService = gameService;
            _dbContext = dbContext;
            _responseCache = responseCache;
        }

        [AllowAnonymous]
        [HttpGet("today")]
        public async Task<IActionResult> GetToday(
            [FromQuery] bool refresh = false,
            CancellationToken ct = default)
        {
            if (refresh)
            {
                await _runner.RunLiveRefreshAsync(ct);
            }

            var snapshots = _cache.GetAll();
            var nowUtc = DateTime.UtcNow;
            var teamLookup = await GetTeamLookupAsync(ct);

            var response = new GameDayScheduleResponse
            {
                LastRefreshUtc = _cache.LastRefreshUtc == DateTime.MinValue
                    ? null
                    : _cache.LastRefreshUtc,
                IsFresh = _cache.IsFresh(CacheFreshnessWindow),
                CurrentFantasyDate = TimeZoneHelper.GetFantasyDateEt(nowUtc),
                CurrentEtDate = TimeZoneHelper.GetNhlGameDateEt(nowUtc),
                Games = snapshots
                    .Select(s => EnrichSummary(
                        new GameDayGameSummary
                        {
                            GameId = s.GameId,
                            GameDate = s.GameDate,
                            StartTimeUtc = s.StartTimeUtc,
                            GameState = s.GameState,
                            AwayAbbreviation = s.AwayAbbreviation,
                            HomeAbbreviation = s.HomeAbbreviation,
                            AwayScore = s.AwayScore,
                            HomeScore = s.HomeScore,
                            AwayShots = s.Boxscore?.AwayTeam.ShotsOnGoal,
                            HomeShots = s.Boxscore?.HomeTeam.ShotsOnGoal,
                            PeriodNumber = s.PeriodNumber,
                            PeriodType = s.PeriodType,
                            PeriodTimeRemaining =
                                s.Boxscore?.Clock?.TimeRemaining,
                            IsIntermission =
                                s.Boxscore?.Clock?.InIntermission,
                            HasBoxscore =
                                !string.Equals(
                                    s.GameState, "FUT",
                                    StringComparison.OrdinalIgnoreCase) &&
                                !string.Equals(
                                    s.GameState, "PRE",
                                    StringComparison.OrdinalIgnoreCase),
                        },
                        teamLookup))
                    .ToList(),
            };

            return Ok(response);
        }

        [AllowAnonymous]
        [HttpGet("{gameId:long}/boxscore")]
        public async Task<IActionResult> GetBoxscore(
            long gameId,
            CancellationToken ct = default)
        {
            var snapshot = _cache.Get(gameId);

            if (snapshot?.Boxscore != null)
            {
                return Ok(snapshot.Boxscore);
            }

            var cacheKey = $"boxscore:{gameId}";

            var cached = _responseCache.TryGet<NhlBoxscoreResponse>(cacheKey);

            if (cached != null)
            {
                return Ok(cached);
            }

            try
            {
                var box = await _gameService.GetBoxscoreAsync(gameId, ct);

                if (box == null)
                {
                    return NotFound(new
                    {
                        message = $"Game {gameId} boxscore is not available."
                    });
                }

                if (!string.Equals(box.GameState, "LIVE",
                        StringComparison.OrdinalIgnoreCase) &&
                    !string.Equals(box.GameState, "CRIT",
                        StringComparison.OrdinalIgnoreCase))
                {
                    _responseCache.Set(cacheKey, box, FinalBoxscoreTtl);
                }

                return Ok(box);
            }
            catch (Exception ex)
            {
                return NotFound(new
                {
                    message = $"Game {gameId} boxscore could not be fetched.",
                    detail = $"{ex.GetType().Name}: {ex.Message}"
                });
            }
        }

        [AllowAnonymous]
        [HttpGet("by-date/{date}")]
        public async Task<IActionResult> GetByDate(
            string date,
            CancellationToken ct = default)
        {
            if (!DateOnly.TryParseExact(
                    date,
                    "yyyy-MM-dd",
                    System.Globalization.CultureInfo.InvariantCulture,
                    System.Globalization.DateTimeStyles.None,
                    out var parsed))
            {
                return BadRequest(new
                {
                    message = "Date must be in yyyy-MM-dd format."
                });
            }

            var nowUtc = DateTime.UtcNow;
            var fantasyDate = TimeZoneHelper.GetFantasyDateEt(nowUtc);
            var minDate = fantasyDate.AddDays(-6);

            if (parsed < minDate || parsed > fantasyDate)
            {
                return BadRequest(new
                {
                    message = "Date must be within the last 7 days."
                });
            }

            var scheduleCacheKey = $"gameday:schedule:{date}";

            var schedule = await _responseCache.GetOrCreateAsync(
                scheduleCacheKey,
                ByDateScheduleTtl,
                () => _gameService.GetScheduleForDateAsync(parsed, ct));

            var teamLookup = await GetTeamLookupAsync(ct);

            var gameStatsForDate = await _dbContext.NhlGameStats
                .AsNoTracking()
                .Where(s => s.GameDate == parsed)
                .ToListAsync(ct);

            var gameStatByGameId = gameStatsForDate
                .ToDictionary(s => s.NhlGameId);

            var games = schedule
                .Select(g =>
                {
                    gameStatByGameId.TryGetValue(
                        g.Id,
                        out var storedGameStat);

                    return EnrichSummary(
                        new GameDayGameSummary
                        {
                            GameId = g.Id,
                            GameDate = g.GameDate,
                            StartTimeUtc = g.StartTimeUtc,
                            GameState = g.GameState,
                            AwayAbbreviation = g.AwayTeam.Abbreviation,
                            HomeAbbreviation = g.HomeTeam.Abbreviation,
                            AwayScore = g.AwayTeam.Score,
                            HomeScore = g.HomeTeam.Score,
                            AwayShots = storedGameStat?.AwayShotsOnGoal,
                            HomeShots = storedGameStat?.HomeShotsOnGoal,
                            PeriodNumber = g.PeriodDescriptor?.Number,
                            PeriodType = g.PeriodDescriptor?.PeriodType,
                            HasBoxscore =
                                !string.Equals(
                                    g.GameState, "FUT",
                                    StringComparison.OrdinalIgnoreCase) &&
                                !string.Equals(
                                    g.GameState, "PRE",
                                    StringComparison.OrdinalIgnoreCase),
                        },
                        teamLookup);
                })
                .ToList();

            var response = new GameDayScheduleResponse
            {
                LastRefreshUtc = nowUtc,
                IsFresh = true,
                CurrentFantasyDate = fantasyDate,
                CurrentEtDate = TimeZoneHelper.GetNhlGameDateEt(nowUtc),
                Games = games,
            };

            return Ok(response);
        }

        private sealed class TeamLookupEntry
        {
            public string FullName { get; set; } = string.Empty;
            public string CommonName { get; set; } = string.Empty;
            public string PlaceName { get; set; } = string.Empty;
            public string? Abbreviation { get; set; }
            public string? ArenaName { get; set; }
            public string? Record { get; set; }
        }

        private async Task<Dictionary<string, TeamLookupEntry>>
            GetTeamLookupAsync(CancellationToken ct)
        {
            return await _responseCache.GetOrCreateAsync(
                TeamLookupCacheKey,
                TeamLookupTtl,
                () => BuildTeamLookupAsync(ct));
        }

        private async Task<Dictionary<string, TeamLookupEntry>>
            BuildTeamLookupAsync(CancellationToken ct)
        {
            var currentSeasonCode =
                NhlFantasyLeague.api.Constants.SeasonCodes.Current;

            var teams = await _dbContext.NhlTeams
                .AsNoTracking()
                .ToListAsync(ct);

            var statsByTeamId = await _dbContext.NhlTeamSeasonStats
                .AsNoTracking()
                .Where(s =>
                    s.NhlSeasonCode == currentSeasonCode &&
                    s.GameTypeId == 2)
                .ToDictionaryAsync(s => s.NhlTeamId, ct);

            var result =
                new Dictionary<string, TeamLookupEntry>(
                    StringComparer.OrdinalIgnoreCase);

            foreach (var team in teams)
            {
                if (string.IsNullOrWhiteSpace(team.Abbreviation))
                {
                    continue;
                }

                var entry = new TeamLookupEntry
                {
                    FullName = team.Name,
                    CommonName = team.CommonName,
                    PlaceName = team.PlaceName,
                    Abbreviation = team.Abbreviation,
                    ArenaName = team.ArenaName,
                };

                if (statsByTeamId.TryGetValue(
                        team.NhlTeamId,
                        out var stat))
                {
                    entry.Record =
                        $"{stat.Wins}-{stat.Losses}-{stat.OtLosses}";
                }

                result[team.Abbreviation] = entry;
            }

            return result;
        }

        private static GameDayGameSummary EnrichSummary(
            GameDayGameSummary summary,
            Dictionary<string, TeamLookupEntry> lookup)
        {
            if (lookup.TryGetValue(
                    summary.AwayAbbreviation,
                    out var away))
            {
                summary.AwayFullName = away.FullName;
                summary.AwayCommonName = away.CommonName;
                summary.AwayPlaceName = away.PlaceName;
                summary.AwayRecord = away.Record;
                summary.AwayArenaName = away.ArenaName;
            }

            if (lookup.TryGetValue(
                    summary.HomeAbbreviation,
                    out var home))
            {
                summary.HomeFullName = home.FullName;
                summary.HomeCommonName = home.CommonName;
                summary.HomePlaceName = home.PlaceName;
                summary.HomeRecord = home.Record;
                summary.HomeArenaName = home.ArenaName;
            }

            return summary;
        }

        [HttpPost("refresh-live")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshLive(CancellationToken ct)
        {
            await _runner.RunLiveRefreshAsync(ct);

            return Ok(new
            {
                message = "Live refresh completed.",
                lastRefreshUtc = _cache.LastRefreshUtc,
                gameCount = _cache.GetAll().Count,
            });
        }

        [HttpPost("refresh-daily")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshDaily(CancellationToken ct)
        {
            await _runner.RunDailyRefreshAsync(ct);

            return Ok(new
            {
                message = "Daily refresh completed.",
            });
        }

        [HttpPost("refresh-post-game")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshPostGame(
            [FromQuery] DateOnly? date,
            CancellationToken ct)
        {
            var targetDateOnly = date ?? TimeZoneHelper
                .GetNhlGameDateEt(DateTime.UtcNow)
                .AddDays(-1);

            await _runner.RunPostGameWriteAsync(targetDateOnly, ct);

            return Ok(new
            {
                message = "Post-game write completed.",
                date = targetDateOnly,
            });
        }

        [HttpPost("refresh-career-stats")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshCareerStats(
            [FromQuery] DateOnly? date,
            CancellationToken ct)
        {
            var targetDateOnly = date ?? TimeZoneHelper
                .GetNhlGameDateEt(DateTime.UtcNow)
                .AddDays(-1);

            await _runner.RunCareerStatsRefreshAsync(targetDateOnly, ct);

            return Ok(new
            {
                message = "Career stats refresh completed.",
                date = targetDateOnly,
            });
        }

        [HttpPost("refresh-weekly")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> RefreshWeekly(CancellationToken ct)
        {
            await _runner.RunWeeklyRefreshAsync(ct);

            return Ok(new
            {
                message = "Weekly deep refresh completed.",
            });
        }

        [HttpPost("recompute")]
        [Authorize(Roles = AuthService.CommissionerRole)]
        public async Task<IActionResult> Recompute(CancellationToken ct)
        {
            await _runner.RunRecomputeAsync(ct);

            return Ok(new
            {
                message = "Recompute completed.",
            });
        }
    }
}