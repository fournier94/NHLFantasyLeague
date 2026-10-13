using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services
{
    /// <summary>
    /// Creates (or repairs) this league's base data: the League row, the
    /// fantasy seasons, the fantasy teams and their active-season links.
    /// Every operation is idempotent: running the setup twice never creates
    /// duplicates and never crashes on the unique season code index.
    ///
    /// Also seeds the two tradeable drafts (for the 2026-2027 and
    /// 2027-2028 seasons) and their picks. Every team starts with one
    /// pick in each of five rounds, in team-id order. The real lottery
    /// order can be applied later.
    /// </summary>
    public class LeagueSetupService
    {
        // ================================================================
        // ====================  EDIT THESE VALUES  =======================
        // ================================================================
        // These values are the source of truth for the league setup.
        // Change them here, then call POST /api/league/setup again: the
        // setup creates what is missing and updates what already exists.

        // Display name of the league.
        private const string LeagueName = "Ligue Keeper";

        // Roster shape from the league rules: 29 players per team =
        // 12 forwards + 6 defensemen + 1 goalie (active lineup),
        // 7 on the bench (4 F / 2 D / 1 G) and 3 prospects.
        private const int MaximumRosterSize = 29;
        private const int ActiveForwardCount = 12;
        private const int ActiveDefensemanCount = 6;
        private const int ActiveGoalieCount = 1;
        private const int BenchForwardCount = 4;
        private const int BenchDefensemanCount = 2;
        private const int BenchGoalieCount = 1;
        private const int ProspectCount = 3;

        // Minimum number of players each DG must drop before the annual draft.
        // DGs may drop more than this minimum; they keep all players they do not drop.
        private const int MinimumDropCount = 5;

        // One fantasy team per DG. Replace a name here when a DG is replaced;
        // matching is by name and existing teams are never deleted.
        private static readonly string[] TeamNames = new string[]
        {
            "Mathieu",
            "Antho",
            "Mig",
            "Olivier",
            "Farn",
            "Melis",
            "Gui",
            "Jp",
            "Kev",
            "Frank",
            "Max",
            "Albo"
        };

        // ----- Season 2026-2027 -----
        private const string CurrentSeasonName = "2026-2027";
        private const int CurrentSeasonNhlSeasonCode = 20262027;
        private static readonly DateOnly CurrentSeasonStartDate = new DateOnly(2026, 09, 28);
        private static readonly DateOnly CurrentSeasonEndDate = new DateOnly(2027, 6, 30);

        // 119 000 000$ = 104 000 000$ NHL cap + 15 000 000$ cushion.
        private const decimal CurrentSeasonSalaryCap = 119000000m;
        private const decimal CurrentSeasonSalaryFloor = 77000000m;

        // ----- OPTIONAL: next season (2027-2028) -----
        // Set CreateNextSeason to true and fill in the real 2027-2028 salary
        // cap and floor when they are known. While false, the block below
        // is skipped in Step 2.
        //
        // NOTE: even when this is false, the 2027-2028 season is still
        // created by the draft-seeding step at the bottom of this file,
        // but with SalaryCap = 0 and SalaryFloor = 0. Anywhere the UI
        // needs a number, a 0 cap falls back to the current season's cap,
        // so nothing breaks. Flipping this to true is only about having
        // the real cap/floor on file for the projection table.
        private static readonly bool CreateNextSeason = false;
        private const string NextSeasonName = "2027-2028";
        private const int NextSeasonNhlSeasonCode = 20272028;
        private static readonly DateOnly NextSeasonStartDate = new DateOnly(2027, 10, 1);
        private static readonly DateOnly NextSeasonEndDate = new DateOnly(2028, 6, 30);

        // Fill in the real 2027-2028 salary cap and floor before
        // setting CreateNextSeason to true.
        private const decimal NextSeasonSalaryCap = 0m;
        private const decimal NextSeasonSalaryFloor = 0m;

        // ----- Seasons that must exist in the DB -----
        //
        // Two past seasons are needed so the roster popup can display
        // their FP: PlayerSeasonStat has a FK to Season, so no Season
        // row means no season stats for that year.
        //
        // Two future seasons are needed for the tradeable drafts:
        // league rules let managers trade 2026-2027 and 2027-2028
        // picks and nothing beyond.
        //
        // All four are created by the seeding step below if they are
        // missing. Cap and floor are 0 for the past and future ones
        // because they are only used as labels and FK targets, not
        // for cap math.
        private static readonly (string Name, int Code)[] SeasonsToEnsure =
            new[]
            {
                ("2024-2025", 20242025),
                ("2025-2026", 20252026),
                ("2026-2027", 20262027),
                ("2027-2028", 20272028),
            };

        // The two seasons whose drafts are tradeable. This is a subset
        // of SeasonsToEnsure; the actual draft rows and pick seeding
        // only run for these.
        private static readonly int[] DraftSeasonCodes = new[]
        {
            20262027,
            20272028,
        };

        // Number of rounds each draft has. Every team gets one pick
        // per round, so this is also the number of picks each team
        // starts with.
        private const int DraftRounds = 5;

        // ================================================================
        // ==================  END OF EDITABLE VALUES  ====================
        // ================================================================

        private readonly AppDbContext _dbContext;

        /// <summary>
        /// Creates the setup service.
        /// </summary>
        /// <param name="dbContext">Database context used to read and write league data.</param>
        public LeagueSetupService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /// <summary>
        /// Runs the full idempotent setup: league, seasons, fantasy teams,
        /// their active-season links, and the two tradeable drafts with
        /// their seeded picks. Reports what was created and updated.
        /// </summary>
        /// <returns>A report listing everything the setup created or updated.</returns>
        /// <exception cref="InvalidOperationException">
        /// Thrown when no season exists after the season step, which would make
        /// the team-to-season links impossible.
        /// </exception>
        public async Task<LeagueSetupResultDto> SetupLeagueAsync()
        {
            var result = new LeagueSetupResultDto();

            // ----- Step 1: the League row -------------------------------
            var league = await _dbContext.Leagues
                .FirstOrDefaultAsync(l => l.Name == LeagueName);

            if (league == null)
            {
                // No league with the configured name: fall back to the first
                // league row, which may exist under an older name.
                league = await _dbContext.Leagues
                    .OrderBy(l => l.Id)
                    .FirstOrDefaultAsync();
            }

            if (league == null)
            {
                league = new League
                {
                    Name = LeagueName
                };

                _dbContext.Leagues.Add(league);

                result.Created.Add($"League '{LeagueName}' created.");
            }
            else
            {
                result.Updated.Add($"League '{LeagueName}' updated.");
            }

            // Always write the values from the editable block above, so edits
            // to the constants are applied on the next run.
            league.Name = LeagueName;
            league.MaximumRosterSize = MaximumRosterSize;
            league.ActiveForwardCount = ActiveForwardCount;
            league.ActiveDefensemanCount = ActiveDefensemanCount;
            league.ActiveGoalieCount = ActiveGoalieCount;
            league.BenchForwardCount = BenchForwardCount;
            league.BenchDefensemanCount = BenchDefensemanCount;
            league.BenchGoalieCount = BenchGoalieCount;
            league.ProspectCount = ProspectCount;
            league.MinimumDropCount = MinimumDropCount;

            // Save now so PostgreSQL generates the League id used below.
            await _dbContext.SaveChangesAsync();

            // ----- Step 2: the seasons ----------------------------------
            foreach (var definition in GetSeasonDefinitions())
            {
                // Always look up by NhlSeasonCode: that column has a unique
                // index and a stats sync may already have auto-created the row
                // with SalaryCap = 0 (see NhlStatsService).
                var season = await _dbContext.Seasons
                    .FirstOrDefaultAsync(s => s.NhlSeasonCode == definition.NhlSeasonCode);

                if (season == null)
                {
                    season = new Season
                    {
                        Name = definition.Name,
                        StartDate = definition.StartDate,
                        EndDate = definition.EndDate,
                        SalaryCap = definition.SalaryCap,
                        SalaryFloor = definition.SalaryFloor,
                        NhlSeasonCode = definition.NhlSeasonCode,
                        LeagueId = league.Id
                    };

                    _dbContext.Seasons.Add(season);

                    result.Created.Add($"Season {definition.Name} created.");
                }
                else
                {
                    var capWasMissing =
                        season.SalaryCap == 0m && definition.SalaryCap != 0m;

                    season.Name = definition.Name;
                    season.StartDate = definition.StartDate;
                    season.EndDate = definition.EndDate;
                    season.SalaryCap = definition.SalaryCap;
                    season.SalaryFloor = definition.SalaryFloor;
                    season.LeagueId = league.Id;

                    // Overwriting the values repairs seasons that a stats sync
                    // auto-created earlier with SalaryCap = 0.
                    result.Updated.Add(capWasMissing
                        ? $"Season {definition.Name} updated (cap fixed)."
                        : $"Season {definition.Name} updated.");
                }
            }

            // Save now so PostgreSQL generates the Season ids used below.
            await _dbContext.SaveChangesAsync();

            // Resolve the current season by SeasonCodes.Current, not by
            // "latest StartDate". The future draft seasons (2027-2028,
            // etc.) have a later StartDate and would otherwise be
            // picked on a second setup run, unlinking every team from
            // its real season.
            var currentSeason = await Data.SeasonQueries
                .GetCurrentSeasonAsync(_dbContext);

            if (currentSeason == null)
            {
                throw new InvalidOperationException(
                    "No season exists after setup; fantasy teams could not be linked.");
            }

            // ----- Step 3: the fantasy teams ----------------------------
            var teams = new List<FantasyTeam>();

            foreach (var teamName in TeamNames)
            {
                var team = await _dbContext.FantasyTeams
                    .FirstOrDefaultAsync(t =>
                        t.LeagueId == league.Id &&
                        t.Name == teamName);

                if (team == null)
                {
                    team = new FantasyTeam
                    {
                        Name = teamName,
                        LeagueId = league.Id
                    };

                    _dbContext.FantasyTeams.Add(team);

                    result.Created.Add($"Fantasy team '{teamName}' created.");
                }

                teams.Add(team);
            }

            // Save now so PostgreSQL generates the FantasyTeam ids used below.
            await _dbContext.SaveChangesAsync();

            // ----- Step 4: link every team to the current season --------
            foreach (var team in teams)
            {
                var link = await _dbContext.FantasyTeamSeasons
                    .FirstOrDefaultAsync(fts =>
                        fts.FantasyTeamId == team.Id &&
                        fts.SeasonId == currentSeason.Id);

                if (link == null)
                {
                    link = new FantasyTeamSeason
                    {
                        FantasyTeamId = team.Id,
                        SeasonId = currentSeason.Id,
                        IsActive = true
                    };

                    _dbContext.FantasyTeamSeasons.Add(link);

                    result.Created.Add(
                        $"Team '{team.Name}' linked to season {currentSeason.Name} (active).");
                }
            }

            // Final save: writes the new FantasyTeamSeason rows.
            await _dbContext.SaveChangesAsync();

            // ----- Step 5: ensure every season row exists --------------
            //
            // Creates any missing season row in SeasonsToEnsure. The
            // 2026-2027 row already exists from Step 2 with its real
            // cap and floor; the others are created with cap = 0 and
            // floor = 0 because they only serve as labels and FK
            // targets for PlayerSeasonStat / DraftPick.
            //
            // The two past seasons are needed so the roster popup can
            // display their FP: PlayerSeasonStat has a FK to Season,
            // so no Season row means no season stats for that year.
            foreach (var (name, code) in SeasonsToEnsure)
            {
                var existing = await _dbContext.Seasons
                    .FirstOrDefaultAsync(s => s.NhlSeasonCode == code);

                if (existing != null)
                {
                    continue;
                }

                var startYear = code / 10000;
                var endYear = startYear + 1;

                _dbContext.Seasons.Add(new Season
                {
                    Name = name,
                    StartDate = new DateOnly(startYear, 10, 1),
                    EndDate = new DateOnly(endYear, 6, 30),
                    SalaryCap = 0m,
                    SalaryFloor = 0m,
                    NhlSeasonCode = code,
                    LeagueId = league.Id
                });

                result.Created.Add($"Season {name} created.");
            }

            await _dbContext.SaveChangesAsync();

            // ----- Step 6: the drafts and their seeded picks ------------
            var draftSeasonCodes = DraftSeasonCodes.ToList();

            var draftSeasonRows = await _dbContext.Seasons
                .Where(s => draftSeasonCodes.Contains(s.NhlSeasonCode))
                .OrderBy(s => s.NhlSeasonCode)
                .ToListAsync();

            foreach (var draftSeason in draftSeasonRows)
            {
                var draft = await _dbContext.Drafts
                    .FirstOrDefaultAsync(d =>
                        d.SeasonId == draftSeason.Id);

                if (draft == null)
                {
                    // A draft is held the summer before the season
                    // starts, so July 1 of the season's start year.
                    // The exact date can be edited later via the
                    // admin page.
                    var draftYear = draftSeason.NhlSeasonCode / 10000;

                    draft = new Draft
                    {
                        SeasonId = draftSeason.Id,
                        DraftDate = new DateTime(
                            draftYear, 7, 1, 0, 0, 0,
                            DateTimeKind.Utc),
                        NumberOfRounds = DraftRounds
                    };

                    _dbContext.Drafts.Add(draft);
                    await _dbContext.SaveChangesAsync();

                    result.Created.Add(
                        $"Draft for season {draftSeason.Name} created.");
                }

                // Seed picks only when the draft has none yet, so the
                // whole setup is idempotent and trades on existing
                // picks are never overwritten.
                var existingPickCount = await _dbContext.DraftPicks
                    .CountAsync(p => p.DraftId == draft.Id);

                if (existingPickCount > 0)
                {
                    continue;
                }

                // Linear seeding: round 1 has one pick per team in
                // team-id order, round 2 follows, etc. The real draft
                // order is set later by lottery / final standings and
                // can be adjusted by the commissioner.
                var orderedTeams = teams
                    .OrderBy(t => t.Id)
                    .ToList();

                foreach (var round in Enumerable.Range(1, DraftRounds))
                {
                    for (var i = 0; i < orderedTeams.Count; i++)
                    {
                        _dbContext.DraftPicks.Add(new DraftPick
                        {
                            DraftId = draft.Id,
                            Round = round,
                            PickNumber = i + 1,
                            OriginalOwnerFantasyTeamId =
                                orderedTeams[i].Id,
                            CurrentOwnerFantasyTeamId =
                                orderedTeams[i].Id
                        });
                    }
                }

                await _dbContext.SaveChangesAsync();

                result.Created.Add(
                    $"Draft picks seeded for {draftSeason.Name} " +
                    $"({orderedTeams.Count} teams x {DraftRounds} rounds).");
            }

            result.Summary =
                $"Setup complete: {result.Created.Count} created, " +
                $"{result.Updated.Count} updated.";

            return result;
        }

        /// <summary>
        /// Returns the league overview (league + seasons + teams), or null
        /// when the setup has not been run yet.
        /// </summary>
        /// <returns>The league summary DTO, or null when no league row exists.</returns>
        public async Task<LeagueSummaryDto?> GetLeagueAsync()
        {
            var league = await _dbContext.Leagues
                .OrderBy(l => l.Id)
                .FirstOrDefaultAsync();

            if (league == null)
            {
                return null;
            }

            var seasons = await _dbContext.Seasons
                .Where(s => s.LeagueId == league.Id)
                .OrderBy(s => s.NhlSeasonCode)
                .ToListAsync();

            var teams = await _dbContext.FantasyTeams
                .Where(t => t.LeagueId == league.Id)
                .OrderBy(t => t.Name)
                .ToListAsync();

            var currentSeason = seasons
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefault();

            return new LeagueSummaryDto
            {
                Id = league.Id,
                Name = league.Name,
                MaximumRosterSize = league.MaximumRosterSize,
                ActiveForwardCount = league.ActiveForwardCount,
                ActiveDefensemanCount = league.ActiveDefensemanCount,
                ActiveGoalieCount = league.ActiveGoalieCount,
                BenchForwardCount = league.BenchForwardCount,
                BenchDefensemanCount = league.BenchDefensemanCount,
                BenchGoalieCount = league.BenchGoalieCount,
                ProspectCount = league.ProspectCount,
                MinimumDropCount = league.MinimumDropCount,
                Seasons = seasons
                    .Select(s => ToSeasonDto(s, s.Id == currentSeason?.Id))
                    .ToList(),
                CurrentSeason = currentSeason == null
                    ? null
                    : ToSeasonDto(currentSeason, true),
                Teams = teams.Select(ToFantasyTeamDto).ToList()
            };
        }

        /// <summary>
        /// Returns every season ordered by NHL season code, with the season
        /// that starts the latest flagged as current.
        /// </summary>
        /// <returns>The list of season DTOs.</returns>
        public async Task<List<SeasonDto>> GetSeasonsAsync()
        {
            var seasons = await _dbContext.Seasons
                .OrderBy(s => s.NhlSeasonCode)
                .ToListAsync();

            var currentSeason = seasons
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefault();

            return seasons
                .Select(s => ToSeasonDto(s, s.Id == currentSeason?.Id))
                .ToList();
        }

        /// <summary>
        /// Returns every fantasy team ordered by name.
        /// </summary>
        /// <returns>The list of fantasy team DTOs.</returns>
        public async Task<List<FantasyTeamDto>> GetTeamsAsync()
        {
            var teams = await _dbContext.FantasyTeams
                .OrderBy(t => t.Name)
                .ToListAsync();

            return teams.Select(ToFantasyTeamDto).ToList();
        }

        /// <summary>
        /// Builds the list of seasons to create or update from the editable
        /// values at the top of the class.
        /// </summary>
        private static List<SeasonDefinition> GetSeasonDefinitions()
        {
            var definitions = new List<SeasonDefinition>
            {
                new SeasonDefinition
                {
                    Name = CurrentSeasonName,
                    StartDate = CurrentSeasonStartDate,
                    EndDate = CurrentSeasonEndDate,
                    SalaryCap = CurrentSeasonSalaryCap,
                    SalaryFloor = CurrentSeasonSalaryFloor,
                    NhlSeasonCode = CurrentSeasonNhlSeasonCode
                }
            };

            // The 2027-2028 season is only included when CreateNextSeason is
            // true. (When false, it is still created later by the draft-
            // seeding step, but with cap = 0 and floor = 0.)
            if (CreateNextSeason)
            {
                definitions.Add(new SeasonDefinition
                {
                    Name = NextSeasonName,
                    StartDate = NextSeasonStartDate,
                    EndDate = NextSeasonEndDate,
                    SalaryCap = NextSeasonSalaryCap,
                    SalaryFloor = NextSeasonSalaryFloor,
                    NhlSeasonCode = NextSeasonNhlSeasonCode
                });
            }

            return definitions;
        }

        /// <summary>
        /// Maps a Season entity to its DTO.
        /// </summary>
        /// <param name="season">Season entity read from the database.</param>
        /// <param name="isCurrent">True when this is the current season.</param>
        private static SeasonDto ToSeasonDto(Season season, bool isCurrent)
        {
            return new SeasonDto
            {
                Id = season.Id,
                Name = season.Name,
                StartDate = season.StartDate,
                EndDate = season.EndDate,
                SalaryCap = season.SalaryCap,
                SalaryFloor = season.SalaryFloor,
                NhlSeasonCode = season.NhlSeasonCode,
                IsCurrent = isCurrent
            };
        }

        /// <summary>
        /// Maps a FantasyTeam entity to its DTO.
        /// </summary>
        /// <param name="team">Fantasy team entity read from the database.</param>
        private static FantasyTeamDto ToFantasyTeamDto(FantasyTeam team)
        {
            return new FantasyTeamDto
            {
                Id = team.Id,
                Name = team.Name
            };
        }

        /// <summary>
        /// Describes one season to create or update during the setup.
        /// </summary>
        private sealed class SeasonDefinition
        {
            /// <summary>Season display name, for example "2026-2027".</summary>
            public string Name { get; set; } = string.Empty;

            /// <summary>First day of the season.</summary>
            public DateOnly StartDate { get; set; }

            /// <summary>Last day of the season.</summary>
            public DateOnly EndDate { get; set; }

            /// <summary>Salary cap of the season, in dollars.</summary>
            public decimal SalaryCap { get; set; }

            /// <summary>Salary floor of the season, in dollars.</summary>
            public decimal SalaryFloor { get; set; }

            /// <summary>NHL season code, for example 20262027.</summary>
            public int NhlSeasonCode { get; set; }
        }
    }
}