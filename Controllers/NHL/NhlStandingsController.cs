using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;

namespace NhlFantasyLeague.api.Controllers.NHL
{
    /// <summary>
    /// Read-only NHL standings endpoint available to every authenticated
    /// user (not just commissioners). Powers the "Équipes" section of the
    /// Statistiques page.
    ///
    /// This mirrors NhlTeamController.GetTeamSeasonStats exactly (same
    /// columns, same filtering by season code and game type) but lives in
    /// its own controller so the [Authorize(Roles = Commissioner)] on
    /// NhlTeamController does not apply. The sync endpoints that DO belong
    /// to the commissioner stay in NhlTeamController untouched.
    ///
    /// Read-only, idempotent, no writes.
    /// </summary>
    [Authorize]
    [ApiController]
    [Route("api/[controller]")]
    public class NhlStandingsController : ControllerBase
    {
        private readonly AppDbContext _dbContext;

        public NhlStandingsController(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /// <summary>
        /// Returns every NhlTeamSeasonStat row for one season and game
        /// type, joined with the team's identity and conference/division
        /// fields so the frontend can group by conference, division, or
        /// render a single league-wide table.
        ///
        /// Omit seasonCode to target the current season
        /// (SeasonCodes.Current). Game type defaults to 2 (regular
        /// season); pass 3 for playoffs.
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

                    s.PowerPlayPct,
                    s.PenaltyKillPct,
                    s.FaceoffWinPct,

                    s.LastUpdatedUtc,
                })
                .ToListAsync(ct);

            return Ok(rows);
        }
    }
}