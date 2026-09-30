using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// Assembles the full player detail payload from the database.
    /// No NHL API calls: everything comes from Player, PlayerCareerStat,
    /// PlayerContract, PlayerInjuryHistory, PlayerGameLog,
    /// PlayerSeasonStat, and RosterEntry.
    /// </summary>
    public class PlayerDetailService
    {
        private readonly AppDbContext _dbContext;

        /// <summary>NHL season code of the current season (2026-27).</summary>
        private const int CurrentSeasonNhlCode = 20262027;

        /// <summary>NHL season code of the previous season (2025-26).</summary>
        private const int PreviousSeasonNhlCode = 20252026;

        /// <summary>How many recent games to include in the game log.</summary>
        private const int RecentGameCount = 10;

        public PlayerDetailService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        public async Task<PlayerDetailDto?> GetPlayerDetailAsync(int nhlPlayerId)
        {
            var player = await _dbContext.Players
                .Include(p => p.NhlTeam)
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return null;
            }

            var contracts = await _dbContext.PlayerContracts
                .Where(c => c.PlayerId == player.Id)
                .OrderBy(c => c.StartSeason)
                .ToListAsync();

            var history = await _dbContext.PlayerInjuryHistories
                .Where(h => h.PlayerId == player.Id)
                .OrderByDescending(h => h.FirstSeenAt)
                .ToListAsync();

            var careerRows = await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .OrderBy(s => s.Season)
                .ThenBy(s => s.GameTypeId)
                .ThenBy(s => s.Sequence)
                .ToListAsync();

            var currentSeason = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == CurrentSeasonNhlCode);

            RosterEntry? entry = null;

            if (currentSeason != null)
            {
                entry = await _dbContext.RosterEntries
                    .Include(e => e.FantasyTeam)
                    .FirstOrDefaultAsync(e =>
                        e.PlayerId == player.Id &&
                        e.SeasonId == currentSeason.Id);
            }

            PlayerSeasonStat? fantasySeasonStat = null;

            if (currentSeason != null)
            {
                fantasySeasonStat = await _dbContext.PlayerSeasonStats
                    .FirstOrDefaultAsync(s =>
                        s.PlayerId == player.Id &&
                        s.SeasonId == currentSeason.Id);
            }

            var previousSeason = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == PreviousSeasonNhlCode);

            PlayerSeasonStat? lastSeasonFantasyStat = null;

            if (previousSeason != null)
            {
                lastSeasonFantasyStat = await _dbContext.PlayerSeasonStats
                    .FirstOrDefaultAsync(s =>
                        s.PlayerId == player.Id &&
                        s.SeasonId == previousSeason.Id);
            }

            // Every current-season game for this player, sorted oldest
            // first, so we can slice them into quarters.
            var currentSeasonGames = new List<PlayerGameLog>();

            if (currentSeason != null)
            {
                currentSeasonGames = await _dbContext.PlayerGameLogs
                    .Include(g => g.OpponentNhlTeam)
                    .Where(g =>
                        g.PlayerId == player.Id &&
                        g.SeasonId == currentSeason.Id)
                    .OrderBy(g => g.GameDate)
                    .ThenBy(g => g.NhlGameId)
                    .ToListAsync();
            }

            // Recent games, most recent first, for the game log table.
            var recentGames = currentSeasonGames
                .OrderByDescending(g => g.GameDate)
                .ThenByDescending(g => g.NhlGameId)
                .Take(RecentGameCount)
                .ToList();

            // Month boundaries: earliest and latest regular-season game
            // dates across EVERY player in the league this season, then
            // one row per calendar month that contains at least one game.
            var seasonMonths = await BuildSeasonMonthsAsync(
                player.Id,
                currentSeason,
                currentSeasonGames);

            // Previous NHL team lookup.
            NhlTeam? previousTeam = null;

            if (player.PreviousNhlTeamId.HasValue)
            {
                previousTeam = await _dbContext.NhlTeams
                    .FirstOrDefaultAsync(t =>
                        t.NhlTeamId == player.PreviousNhlTeamId.Value);
            }

            var currentContract = contracts.FirstOrDefault(c =>
                c.StartSeason <= CurrentSeasonNhlCode &&
                c.EndSeason >= CurrentSeasonNhlCode);

            return new PlayerDetailDto
            {
                PlayerId = player.Id,
                NhlPlayerId = player.NhlPlayerId,
                FirstName = player.FirstName,
                LastName = player.LastName,
                Position = player.Position,
                ShootsCatches = player.ShootsCatches,
                HeadshotUrl = player.HeadshotUrl,
                HeroImageUrl = player.HeroImageUrl,

                NhlTeamAbbreviation = player.NhlTeam?.Abbreviation,
                NhlTeamName = player.NhlTeam?.Name,
                NhlTeamLogoUrl = player.NhlTeam?.LogoUrl,
                PreviousNhlTeamAbbreviation = previousTeam?.Abbreviation,
                PreviousNhlTeamName = previousTeam?.Name,

                Status = player.Status.ToString(),

                BirthDate = player.BirthDate,
                Age = CalculateAge(player.BirthDate),
                BirthCity = player.BirthCity,
                BirthCountry = player.BirthCountry,

                HeightInInches = player.HeightInInches,
                HeightInCentimeters = player.HeightInInches.HasValue
                    ? (int)Math.Round(player.HeightInInches.Value * 2.54)
                    : null,
                WeightInPounds = player.WeightInPounds,
                WeightInKilograms = player.WeightInPounds.HasValue
                    ? (int)Math.Round(player.WeightInPounds.Value * 0.45359237)
                    : null,

                DraftYear = player.DraftYear,
                DraftTeamAbbreviation = player.DraftTeamAbbreviation,
                DraftRound = player.DraftRound,
                DraftPickInRound = player.DraftPickInRound,
                DraftOverallPick = player.DraftOverallPick,

                IsInjured = player.IsInjured,
                InjuryStatus = player.InjuryStatus,
                InjuryKind = player.InjuryKind.ToString(),
                InjuryShortDescription = player.InjuryShortDescription,
                InjuryLongDescription = player.InjuryLongDescription,
                InjuryType = player.InjuryType,
                InjuryDetail = player.InjuryDetail,
                InjurySide = player.InjurySide,
                InjuryReturnDate = player.InjuryReturnDate,
                InjuryFantasyStatus = player.InjuryFantasyStatus,
                InjuryUpdatedAt = player.InjuryUpdatedAt,
                InjuryHistory = history
                    .Select(h => new InjuryHistoryDto
                    {
                        InjuryStatus = h.InjuryStatus,
                        InjuryDescription = h.InjuryDescription,
                        TeamAbbreviation = h.TeamAbbreviation,
                        FirstSeenAt = h.FirstSeenAt,
                        LastSeenAt = h.LastSeenAt,
                        ResolvedAt = h.ResolvedAt
                    })
                    .ToList(),

                Contracts = contracts
                    .Select(c => new ContractDto
                    {
                        Salary = c.Salary,
                        StartSeason = c.StartSeason,
                        EndSeason = c.EndSeason,
                        YearsRemaining = CalculateYearsRemaining(c)
                    })
                    .ToList(),

                CurrentCapHit = currentContract?.Salary,

                FantasyTeamId = entry?.FantasyTeamId,
                FantasyTeamName = entry?.FantasyTeam?.Name,
                RosterStatus = entry?.RosterStatus.ToString(),
                RosterSlot = entry?.RosterSlot,
                FantasySalary = entry?.FantasySalary,
                SeasonFantasyPoints = fantasySeasonStat?.FantasyPoints,
                SeasonHatTricks = fantasySeasonStat?.HatTricks,
                CurrentSeasonStats = fantasySeasonStat == null
                    ? null
                    : new CurrentSeasonStatsDto
                    {
                        GamesPlayed = fantasySeasonStat.GamesPlayed,
                        Goals = fantasySeasonStat.Goals,
                        Assists = fantasySeasonStat.Assists,
                        Points = fantasySeasonStat.Points,
                        HatTricks = fantasySeasonStat.HatTricks,
                        FantasyPoints = fantasySeasonStat.FantasyPoints
                    },

                LastSeasonStats = lastSeasonFantasyStat == null
                    ? null
                    : new CurrentSeasonStatsDto
                    {
                        GamesPlayed = lastSeasonFantasyStat.GamesPlayed,
                        Goals = lastSeasonFantasyStat.Goals,
                        Assists = lastSeasonFantasyStat.Assists,
                        Points = lastSeasonFantasyStat.Points,
                        HatTricks = lastSeasonFantasyStat.HatTricks,
                        FantasyPoints = lastSeasonFantasyStat.FantasyPoints
                    },

                RegularSeason = BuildCareerRows(careerRows, gameType: 2, CareerCategory.Main),
                Playoffs = BuildCareerRows(careerRows, gameType: 3, CareerCategory.Main),
                Tournaments = BuildCareerRows(careerRows, gameType: 2, CareerCategory.Tournament),
                YouthMinor = BuildCareerRows(careerRows, gameType: 2, CareerCategory.YouthMinor),
                NhlTotals = BuildNhlTotals(careerRows),

                RecentGames = recentGames
                    .Select(g => new GameLogRowDto
                    {
                        NhlGameId = g.NhlGameId,
                        GameDate = g.GameDate,
                        OpponentAbbreviation = g.OpponentNhlTeam?.Abbreviation ?? string.Empty,
                        IsHomeGame = g.IsHomeGame,
                        Goals = g.Goals,
                        Assists = g.Assists,
                        Points = g.Points,
                        PenaltyMinutes = g.PenaltyMinutes,
                        PlusMinus = g.PlusMinus,
                        Shots = g.Shots,
                        FantasyPoints = g.FantasyPoints,
                        GoalieWin = g.GoalieWin,
                        GoalieOvertimeLoss = g.GoalieOvertimeLoss,
                        Shutout = g.Shutout,
                        GoalsAgainst = g.GoalsAgainst,
                        ShotsAgainst = g.ShotsAgainst,
                        Saves = g.ShotsAgainst - g.GoalsAgainst
                    })
                    .ToList(),

                SeasonMonths = seasonMonths
            };
        }

        // =================================================================
        // Months helpers
        // =================================================================

        private async Task<List<MonthDto>> BuildSeasonMonthsAsync(
    int playerId,
    Season? currentSeason,
    List<PlayerGameLog> playerGames)
        {
            if (currentSeason == null)
            {
                return new List<MonthDto>();
            }

            // Whole-league range: earliest and latest game date this
            // season across every player, so all players' monthly rows
            // line up on the same calendar months.
            var range = await _dbContext.PlayerGameLogs
                .Where(g => g.SeasonId == currentSeason.Id)
                .GroupBy(g => 1)
                .Select(g => new
                {
                    First = g.Min(x => x.GameDate),
                    Last = g.Max(x => x.GameDate)
                })
                .FirstOrDefaultAsync();

            if (range == null)
            {
                return new List<MonthDto>();
            }

            var firstDate = range.First;
            var lastDate = range.Last;

            if (lastDate < firstDate)
            {
                return new List<MonthDto>();
            }

            // French month abbreviations, indexed 1..12. Used as the row
            // label so the frontend gets a ready-to-display string.
            var monthLabels = new[]
            {
                "", "Janv.", "Févr.", "Mars", "Avr.", "Mai", "Juin",
                "Juil.", "Août", "Sept.", "Oct.", "Nov.", "Déc."
            };

            var months = new List<MonthDto>();

            // Start at the first day of the first month, walk forward one
            // calendar month at a time until we pass the last game date.
            var cursor = new DateOnly(firstDate.Year, firstDate.Month, 1);

            while (cursor <= lastDate)
            {
                var monthStart = cursor;
                var monthEnd = cursor.AddMonths(1).AddDays(-1);

                // Clip to the actual season range so the first and last
                // months do not extend before/after any game was played.
                var effectiveStart =
                    monthStart < firstDate ? firstDate : monthStart;

                var effectiveEnd =
                    monthEnd > lastDate ? lastDate : monthEnd;

                var games = playerGames
                    .Where(g =>
                        g.GameDate >= effectiveStart &&
                        g.GameDate <= effectiveEnd)
                    .ToList();

                months.Add(new MonthDto
                {
                    Label = $"{monthLabels[cursor.Month]} {cursor.Year}",
                    StartDate = effectiveStart,
                    EndDate = effectiveEnd,
                    GamesPlayed = games.Count,
                    Goals = games.Sum(g => g.Goals),
                    Assists = games.Sum(g => g.Assists),
                    Points = games.Sum(g => g.Points),
                    PenaltyMinutes = games.Sum(g => g.PenaltyMinutes),
                    PlusMinus = games.Sum(g => g.PlusMinus),
                    Shots = games.Sum(g => g.Shots),
                    Wins = games.Count(g => g.GoalieWin),
                    Losses = games.Count(g =>
                        !g.GoalieWin &&
                        !g.GoalieOvertimeLoss &&
                        (g.ShotsAgainst > 0 || g.GoalsAgainst > 0)),
                    OvertimeLosses = games.Count(g => g.GoalieOvertimeLoss),
                    Shutouts = games.Count(g => g.Shutout),
                    Saves = games.Sum(g => g.ShotsAgainst - g.GoalsAgainst),
                    ShotsAgainst = games.Sum(g => g.ShotsAgainst),
                    GoalsAgainst = games.Sum(g => g.GoalsAgainst),
                    FantasyPoints = games.Sum(g => g.FantasyPoints)
                });

                cursor = cursor.AddMonths(1);
            }

            return months;
        }

        // =================================================================
        // Career helpers
        // =================================================================

        private enum CareerCategory
        {
            Main,
            Tournament,
            YouthMinor
        }

        private static readonly HashSet<string> TournamentLeagues =
            new(StringComparer.OrdinalIgnoreCase)
            {
                "WJC-20", "WJC-18", "WC", "WC-A", "WCup",
                "OG", "4 Nations", "International"
            };

        private static readonly HashSet<string> ProfessionalLeagues =
            new(StringComparer.OrdinalIgnoreCase)
            {
                "NHL", "AHL", "ECHL",
                "WHL", "OHL", "QMJHL", "CHL",
                "NCAA", "H-East", "Big Ten", "NCHC", "ECAC", "WCHA", "CCHA",
                "SHL", "Liiga", "KHL", "DEL", "NL", "Czech", "Czechia",
                "Extraliga", "Allsvenskan", "Mestis", "ICEHL", "EIHL",
                "USHL", "NAHL", "BCHL", "AJHL", "OJHL", "SJHL", "MJHL",
                "MHL", "VHL"
            };

        private static List<CareerRowDto> BuildCareerRows(
            List<PlayerCareerStat> rows,
            int gameType,
            CareerCategory category)
        {
            return rows
                .Where(r =>
                    r.GameTypeId == gameType &&
                    Classify(r.LeagueAbbreviation) == category)
                .OrderByDescending(r => r.Season)
                // Within the same season, put NHL rows on top, then the
                // remaining leagues alphabetically.
                .ThenByDescending(r => r.LeagueAbbreviation == "NHL")
                .ThenBy(r => r.LeagueAbbreviation)
                .Select(r => new CareerRowDto
                {
                    Season = r.Season,
                    SeasonLabel = FormatSeason(r.Season),
                    LeagueAbbreviation = r.LeagueAbbreviation,
                    TeamName = r.TeamName,
                    GameTypeId = r.GameTypeId,
                    GamesPlayed = r.GamesPlayed,
                    Goals = r.Goals,
                    Assists = r.Assists,
                    Points = r.Points,
                    PenaltyMinutes = r.PenaltyMinutes,
                    PlusMinus = r.PlusMinus,
                    PowerPlayGoals = r.PowerPlayGoals,
                    PowerPlayPoints = r.PowerPlayPoints,
                    ShorthandedGoals = r.ShorthandedGoals,
                    ShorthandedPoints = r.ShorthandedPoints,
                    GameWinningGoals = r.GameWinningGoals,
                    OvertimeGoals = r.OvertimeGoals,
                    Shots = r.Shots,
                    ShootingPercentage = r.ShootingPercentage,
                    AverageTimeOnIce = r.AverageTimeOnIce,
                    FaceoffWinningPercentage = r.FaceoffWinningPercentage,
                    Wins = r.Wins,
                    Losses = r.Losses,
                    OvertimeLosses = r.OvertimeLosses,
                    Shutouts = r.Shutouts,
                    Saves = r.Saves,
                    ShotsAgainst = r.ShotsAgainst,
                    SavePercentage = r.SavePercentage,
                    GoalsAgainst = r.GoalsAgainst,
                    GoalsAgainstAverage = r.GoalsAgainstAverage,
                    HatTricks = r.HatTricks
                })
                .ToList();
        }

        private static CareerCategory Classify(string leagueAbbreviation)
        {
            if (string.IsNullOrWhiteSpace(leagueAbbreviation))
            {
                return CareerCategory.YouthMinor;
            }

            if (TournamentLeagues.Contains(leagueAbbreviation))
            {
                return CareerCategory.Tournament;
            }

            if (ProfessionalLeagues.Contains(leagueAbbreviation))
            {
                return CareerCategory.Main;
            }

            return CareerCategory.YouthMinor;
        }

        private static CareerTotalsDto BuildNhlTotals(List<PlayerCareerStat> rows)
        {
            var regular = rows
                .Where(r =>
                    r.GameTypeId == 2 &&
                    string.Equals(r.LeagueAbbreviation, "NHL", StringComparison.OrdinalIgnoreCase))
                .ToList();

            var playoffs = rows
                .Where(r =>
                    r.GameTypeId == 3 &&
                    string.Equals(r.LeagueAbbreviation, "NHL", StringComparison.OrdinalIgnoreCase))
                .ToList();

            var saves = regular.Sum(r => r.Saves);
            var shotsAgainst = regular.Sum(r => r.ShotsAgainst);

            return new CareerTotalsDto
            {
                GamesPlayed = regular.Sum(r => r.GamesPlayed),
                Goals = regular.Sum(r => r.Goals),
                Assists = regular.Sum(r => r.Assists),
                Points = regular.Sum(r => r.Points),
                PenaltyMinutes = regular.Sum(r => r.PenaltyMinutes),
                PlusMinus = regular.Sum(r => r.PlusMinus),
                PowerPlayPoints = regular.Sum(r => r.PowerPlayPoints),
                Shots = regular.Sum(r => r.Shots),
                GameWinningGoals = regular.Sum(r => r.GameWinningGoals),

                PlayoffGamesPlayed = playoffs.Sum(r => r.GamesPlayed),
                PlayoffGoals = playoffs.Sum(r => r.Goals),
                PlayoffAssists = playoffs.Sum(r => r.Assists),
                PlayoffPoints = playoffs.Sum(r => r.Points),
                PlayoffPenaltyMinutes = playoffs.Sum(r => r.PenaltyMinutes),
                PlayoffPowerPlayPoints = playoffs.Sum(r => r.PowerPlayPoints),
                PlayoffShots = playoffs.Sum(r => r.Shots),
                PlayoffGameWinningGoals = playoffs.Sum(r => r.GameWinningGoals),

                Wins = regular.Sum(r => r.Wins),
                Losses = regular.Sum(r => r.Losses),
                OvertimeLosses = regular.Sum(r => r.OvertimeLosses),
                Shutouts = regular.Sum(r => r.Shutouts),
                Saves = saves,
                ShotsAgainst = shotsAgainst,
                GoalsAgainst = regular.Sum(r => r.GoalsAgainst),

                SavePercentage = shotsAgainst > 0
                    ? Math.Round((decimal)saves / shotsAgainst, 3)
                    : 0m,

                PlayoffWins = playoffs.Sum(r => r.Wins),
                PlayoffLosses = playoffs.Sum(r => r.Losses),
                PlayoffOvertimeLosses = playoffs.Sum(r => r.OvertimeLosses),
                PlayoffShutouts = playoffs.Sum(r => r.Shutouts)
            };
        }

        private static int? CalculateAge(DateOnly? birthDate)
        {
            if (birthDate == null)
            {
                return null;
            }

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var age = today.Year - birthDate.Value.Year;

            if (birthDate.Value > today.AddYears(-age))
            {
                age--;
            }

            return age;
        }

        private static int CalculateYearsRemaining(PlayerContract contract)
        {
            var startYear = contract.StartSeason / 10000;
            var endYear = contract.EndSeason / 10000;

            return Math.Max(1, endYear - startYear + 1);
        }

        private static string FormatSeason(int seasonCode)
        {
            var startYear = seasonCode / 10000;
            var endYear = seasonCode % 100;

            return $"{startYear % 100:D2}-{endYear:D2}";
        }
    }
}