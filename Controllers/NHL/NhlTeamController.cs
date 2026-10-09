using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class NhlTeamController : ControllerBase
    {
        private readonly NhlTeamService _nhlTeamService;
        private readonly AppDbContext _dbContext;

        public NhlTeamController(
            NhlTeamService nhlTeamService,
            AppDbContext dbContext)
        {
            _nhlTeamService = nhlTeamService;
            _dbContext = dbContext;
        }

        [HttpGet("teams/sync")]
        public async Task<IActionResult> SyncTeams()
        {
            var teams = await _nhlTeamService.SyncTeamsAsync();

            return Ok(teams);
        }

        /// <summary>
        /// Runs the daily team-season-stats sync immediately:
        /// identity fields + one NhlTeamSeasonStat row per team for
        /// the given season and game type. Idempotent.
        ///
        /// Omit the season code to target the current season
        /// (SeasonCodes.Current). Game type defaults to 2
        /// (regular season); pass 3 for playoffs.
        /// </summary>
        [HttpPost("team-season-stats/sync")]
        public async Task<IActionResult> SyncTeamSeasonStats(
            [FromQuery] int? seasonCode,
            [FromQuery] int gameTypeId = 2,
            CancellationToken ct = default)
        {
            var code = seasonCode
                ?? NhlFantasyLeague.api.Constants.SeasonCodes.Current;

            var result = await _nhlTeamService
                .SyncTeamSeasonStatsAsync(code, gameTypeId, ct);

            if (!result.Success)
            {
                return StatusCode(
                    StatusCodes.Status502BadGateway,
                    result);
            }

            return Ok(result);
        }

        /// <summary>
        /// Returns every NhlTeamSeasonStat row for one season and
        /// game type, joined with the team's name and abbreviation
        /// so a future team stats page can render without a second
        /// query.
        /// </summary>
        [HttpGet("team-season-stats")]
        public async Task<IActionResult> GetTeamSeasonStats(
            [FromQuery] int? seasonCode,
            [FromQuery] int gameTypeId = 2,
            CancellationToken ct = default)
        {
            var code = seasonCode
                ?? NhlFantasyLeague.api.Constants.SeasonCodes.Current;

            var rows = await _dbContext.NhlTeamSeasonStats
                .AsNoTracking()
                .Where(s =>
                    s.NhlSeasonCode == code &&
                    s.GameTypeId == gameTypeId)
                .Include(s => s.NhlTeam)
                .OrderBy(s => s.NhlTeam!.Abbreviation)
                .Select(s => new
                {
                    s.Id,
                    s.NhlTeamId,
                    TeamName = s.NhlTeam!.Name,
                    TeamCommonName = s.NhlTeam.CommonName,
                    TeamPlaceName = s.NhlTeam.PlaceName,
                    TeamAbbreviation = s.NhlTeam.Abbreviation,
                    TeamLogoUrl = s.NhlTeam.LogoUrl,
                    ArenaName = s.NhlTeam.ArenaName,
                    ArenaCity = s.NhlTeam.ArenaCity,
                    ConferenceName = s.NhlTeam.ConferenceName,
                    DivisionName = s.NhlTeam.DivisionName,

                    s.NhlSeasonCode,
                    s.GameTypeId,

                    s.GamesPlayed,
                    s.Wins,
                    s.Losses,
                    s.OtLosses,
                    s.Ties,
                    s.Points,
                    s.PointPctg,
                    s.GamesRemaining,

                    s.GoalsFor,
                    s.GoalsAgainst,
                    s.GoalDifferential,

                    s.HomeWins,
                    s.HomeLosses,
                    s.HomeOtLosses,
                    s.RoadWins,
                    s.RoadLosses,
                    s.RoadOtLosses,
                    s.L10Wins,
                    s.L10Losses,
                    s.L10OtLosses,

                    s.StreakCode,
                    s.StreakCount,

                    s.LeagueSequence,
                    s.ConferenceSequence,
                    s.DivisionSequence,
                    s.WildcardSequence,

                    s.ClinchIndicator,
                    s.WildcardIndicator,

                    s.ShootoutWins,
                    s.ShootoutLosses,

                    s.PowerPlayPct,
                    s.PowerPlayNetPct,
                    s.PenaltyKillPct,
                    s.PenaltyKillNetPct,
                    s.FaceoffWinPct,
                    s.ShotsForPerGame,
                    s.ShotsAgainstPerGame,
                    s.GoalsForPerGame,
                    s.GoalsAgainstPerGame,
                    s.PenaltyMinutesPerGame,

                    s.LastUpdatedUtc,
                })
                .ToListAsync(ct);

            return Ok(rows);
        }

        [HttpGet("roster/{team}")]
        public async Task<IActionResult> GetRoster(string team)
        {
            var roster = await _nhlTeamService.GetRosterAsync(team);

            if (roster == null)
            {
                return NotFound();
            }

            return Ok(roster);
        }

        [HttpGet("players/sync")]
        public async Task<IActionResult> SyncPlayers()
        {
            var result = await _nhlTeamService.SyncPlayersAsync();

            return Ok(result);
        }
    }
}