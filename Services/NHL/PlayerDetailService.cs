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

        /// <summary>How many recent games to include in the game log.</summary>
        private const int RecentGameCount = 10;

        public PlayerDetailService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /// <summary>
        /// Returns the detail payload for one player, or null when the
        /// player does not exist.
        /// </summary>
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

            // Current-season roster entry, if any.
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

            // Current-season fantasy stat row (FantasyPoints, HatTricks).
            PlayerSeasonStat? fantasySeasonStat = null;

            if (currentSeason != null)
            {
                fantasySeasonStat = await _dbContext.PlayerSeasonStats
                    .FirstOrDefaultAsync(s =>
                        s.PlayerId == player.Id &&
                        s.SeasonId == currentSeason.Id);
            }

            // Recent games. Join OpponentNhlTeam so we can build the
            // "vs/@" opponent abbreviation without a second round trip.
            var recentGames = await _dbContext.PlayerGameLogs
                .Include(g => g.OpponentNhlTeam)
                .Where(g => g.PlayerId == player.Id)
                .OrderByDescending(g => g.GameDate)
                .ThenByDescending(g => g.NhlGameId)
                .Take(RecentGameCount)
                .ToListAsync();

            // Previous NHL team lookup (for the "was on X" line).
            NhlTeam? previousTeam = null;

            if (player.PreviousNhlTeamId.HasValue)
            {
                previousTeam = await _dbContext.NhlTeams
                    .FirstOrDefaultAsync(t =>
                        t.NhlTeamId == player.PreviousNhlTeamId.Value);
            }

            // Current cap hit: the contract covering the current season.
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

                FantasyTeamName = entry?.FantasyTeam?.Name,
                RosterStatus = entry?.RosterStatus.ToString(),
                RosterSlot = entry?.RosterSlot,
                FantasySalary = entry?.FantasySalary,
                SeasonFantasyPoints = fantasySeasonStat?.FantasyPoints,
                SeasonHatTricks = fantasySeasonStat?.HatTricks,

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
                        PenaltyMinutes = 0,
                        PlusMinus = 0,
                        Shots = 0,
                        FantasyPoints = g.FantasyPoints,
                        GoalieWin = g.GoalieWin,
                        GoalieOvertimeLoss = g.GoalieOvertimeLoss,
                        Shutout = g.Shutout,
                        GoalsAgainst = g.GoalsAgainst,
                        ShotsAgainst = g.ShotsAgainst,
                        Saves = g.ShotsAgainst - g.GoalsAgainst
                    })
                    .ToList()
            };
        }

        // =================================================================
        // Helpers
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
                "USHL", "NAHL", "BCHL", "AJHL", "OJHL", "SJHL", "MJHL"
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
                    GoalsAgainstAverage = r.GoalsAgainstAverage
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
                Saves = regular.Sum(r => r.Saves),
                ShotsAgainst = regular.Sum(r => r.ShotsAgainst),
                GoalsAgainst = regular.Sum(r => r.GoalsAgainst),

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

        /// <summary>"20252026" -> "25-26". Keeps the row labels short.</summary>
        private static string FormatSeason(int seasonCode)
        {
            var startYear = seasonCode / 10000;
            var endYear = seasonCode % 100;

            return $"{startYear % 100:D2}-{endYear:D2}";
        }
    }
}