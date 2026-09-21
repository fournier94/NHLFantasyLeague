using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlStatsService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public NhlStatsService(
            HttpClient httpClient,
            AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
        }

        public async Task<int> SavePlayerSeasonStatsAsync(
    Player player,
    List<NhlSeasonTotal> seasonTotals)
        {
            var nhlSeasons = seasonTotals
                .Where(s =>
                    s.LeagueAbbrev == "NHL" &&
                    s.GameTypeId == 2)
                .ToList();

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            var savedCount = 0;

            foreach (var stats in nhlSeasons)
            {
                var season = await _dbContext.Seasons
                    .FirstOrDefaultAsync(s =>
                        s.NhlSeasonCode == stats.Season);

                if (season == null)
                {
                    // Keep auto-create so historical player stats are never silently
                    // dropped, but use the real League id instead of a hardcoded 1.
                    // SalaryCap/SalaryFloor stay 0 here: real fantasy seasons
                    // (2026-2027 and later) are created and corrected by LeagueSetupService.
                    var league = await _dbContext.Leagues
                        .OrderBy(l => l.Id)
                        .FirstOrDefaultAsync();

                    if (league == null)
                    {
                        Console.WriteLine(
                            $"[NhlStatsService] No League row exists yet; " +
                            $"skipping season {stats.Season}. " +
                            "Run POST /api/league/setup first.");

                        continue;
                    }

                    var seasonStartYear = stats.Season / 10000;
                    var seasonEndYear = stats.Season % 10000;

                    season = new Season
                    {
                        Name = $"{seasonStartYear}-{(seasonEndYear % 100).ToString("D2")}",
                        StartDate = new DateOnly(seasonStartYear, 10, 1),
                        EndDate = new DateOnly(seasonEndYear, 6, 30),
                        SalaryCap = 0,
                        SalaryFloor = 0,
                        NhlSeasonCode = stats.Season,
                        LeagueId = league.Id
                    };

                    _dbContext.Seasons.Add(season);

                    await _dbContext.SaveChangesAsync();
                }

                // NHL seasonTotals provides a Points value for skaters.
                // For goalies, the NHL response does not provide a Points field,
                // so we calculate points from their goals and assists.
                int points = isGoalie
                    ? stats.Goals + stats.Assists
                    : stats.Points;

                var existingStats = await _dbContext.PlayerSeasonStats
                    .FirstOrDefaultAsync(s =>
                        s.PlayerId == player.Id &&
                        s.SeasonId == season.Id);

                if (existingStats == null)
                {
                    var playerStats = new PlayerSeasonStat
                    {
                        PlayerId = player.Id,
                        SeasonId = season.Id,
                        GamesPlayed = stats.GamesPlayed,
                        Goals = stats.Goals,
                        Assists = stats.Assists,
                        Points = points,
                        PlusMinus = stats.PlusMinus,
                        PenaltyMinutes = stats.PenaltyMinutes,
                        PowerPlayGoals = stats.PowerPlayGoals,
                        PowerPlayPoints = stats.PowerPlayPoints,
                        GameWinningGoals = stats.GameWinningGoals,
                        Shots = stats.Shots,
                        ShootingPercentage = stats.ShootingPercentage,
                        GoalsAgainst = stats.GoalsAgainst,
                        Wins = stats.Wins,
                        Losses = stats.Losses,
                        OvertimeLosses = stats.OvertimeLosses,
                        Shutouts = stats.Shutouts,
                        HatTricks = 0,
                        Saves = stats.ShotsAgainst - stats.GoalsAgainst,
                        ShotsAgainst = stats.ShotsAgainst,
                        SavePercentage = stats.SavePercentage,
                        GoalsAgainstAverage = stats.GoalsAgainstAverage
                    };

                    _dbContext.PlayerSeasonStats.Add(playerStats);
                    savedCount++;
                }
                else
                {
                    existingStats.GamesPlayed = stats.GamesPlayed;
                    existingStats.Goals = stats.Goals;
                    existingStats.Assists = stats.Assists;
                    existingStats.Points = points;
                    existingStats.PlusMinus = stats.PlusMinus;
                    existingStats.PenaltyMinutes = stats.PenaltyMinutes;
                    existingStats.PowerPlayGoals = stats.PowerPlayGoals;
                    existingStats.PowerPlayPoints = stats.PowerPlayPoints;
                    existingStats.GameWinningGoals = stats.GameWinningGoals;
                    existingStats.Shots = stats.Shots;
                    existingStats.ShootingPercentage = stats.ShootingPercentage;
                    existingStats.GoalsAgainst = stats.GoalsAgainst;
                    existingStats.Wins = stats.Wins;
                    existingStats.Losses = stats.Losses;
                    existingStats.OvertimeLosses = stats.OvertimeLosses;
                    existingStats.Shutouts = stats.Shutouts;
                    existingStats.Saves = stats.ShotsAgainst - stats.GoalsAgainst;
                    existingStats.ShotsAgainst = stats.ShotsAgainst;
                    existingStats.SavePercentage = stats.SavePercentage;
                    existingStats.GoalsAgainstAverage = stats.GoalsAgainstAverage;
                }
            }

            await _dbContext.SaveChangesAsync();

            return savedCount;
        }

        public async Task<PlayerSeasonStat?> GetPlayerSeasonStatsAsync(
int nhlPlayerId,
int seasonCode)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return null;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return null;
            }

            return await _dbContext.PlayerSeasonStats
                .FirstOrDefaultAsync(s =>
                    s.PlayerId == player.Id &&
                    s.SeasonId == season.Id);
        }

        public async Task UpdatePlayerSeasonStatsAsync(
int nhlPlayerId,
int seasonCode)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return;
            }

            var logs = await _dbContext.PlayerGameLogs
                .Where(g =>
                    g.PlayerId == player.Id &&
                    g.SeasonId == season.Id)
                .ToListAsync();

            if (logs.Count == 0)
            {
                return;
            }

            var seasonStats = await _dbContext.PlayerSeasonStats
                .FirstOrDefaultAsync(s =>
                    s.PlayerId == player.Id &&
                    s.SeasonId == season.Id);

            if (seasonStats == null)
            {
                seasonStats = new PlayerSeasonStat
                {
                    PlayerId = player.Id,
                    SeasonId = season.Id
                };

                _dbContext.PlayerSeasonStats.Add(seasonStats);
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            // Fantasy points are calculated from the individual game logs.
            seasonStats.FantasyPoints =
                logs.Sum(g => g.FantasyPoints);

            // Hat-tricks are calculated from game logs because
            // NHL season totals do not provide a hat-trick count.
            // Goalies can never receive a hat-trick bonus.
            if (!isGoalie)
            {
                seasonStats.HatTricks =
                    logs.Count(g => g.HatTrick);
            }
            else
            {
                seasonStats.HatTricks = 0;
            }

            await _dbContext.SaveChangesAsync();
        }

        public async Task<List<PlayerCareerStat>> SyncPlayerCareerStatsAsync(int nhlPlayerId)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return new List<PlayerCareerStat>();
            }

            var nhlPlayer = await _httpClient.GetFromJsonAsync<NhlPlayerResponse>(
    $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/landing");

            if (nhlPlayer == null)
            {
                return new List<PlayerCareerStat>();
            }

            var existingStats = await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .ToDictionaryAsync(
                    s => (s.Season, s.GameTypeId, s.Sequence));

            var apiKeys = nhlPlayer.SeasonTotals
                .Select(s => (s.Season, s.GameTypeId, s.Sequence))
                .ToHashSet();

            foreach (var stats in nhlPlayer.SeasonTotals)
            {
                var key = (
                    stats.Season,
                    stats.GameTypeId,
                    stats.Sequence);

                if (!existingStats.TryGetValue(
                        key,
                        out var careerStat))
                {
                    careerStat = new PlayerCareerStat
                    {
                        PlayerId = player.Id,
                        Season = stats.Season,
                        GameTypeId = stats.GameTypeId,
                        Sequence = stats.Sequence
                    };

                    _dbContext.PlayerCareerStats.Add(careerStat);

                    existingStats[key] = careerStat;
                }

                careerStat.LeagueAbbreviation = stats.LeagueAbbrev;
                careerStat.TeamName = stats.TeamName?.Default;

                careerStat.GamesPlayed = stats.GamesPlayed;
                careerStat.GamesStarted = stats.GamesStarted;

                careerStat.Goals = stats.Goals;
                careerStat.Assists = stats.Assists;
                careerStat.Points = stats.Points;

                careerStat.PlusMinus = stats.PlusMinus;
                careerStat.PenaltyMinutes = stats.PenaltyMinutes;

                careerStat.PowerPlayGoals = stats.PowerPlayGoals;
                careerStat.PowerPlayPoints = stats.PowerPlayPoints;

                careerStat.ShorthandedGoals = stats.ShorthandedGoals;
                careerStat.ShorthandedPoints = stats.ShorthandedPoints;

                careerStat.GameWinningGoals = stats.GameWinningGoals;
                careerStat.OvertimeGoals = stats.OvertimeGoals;

                careerStat.Shots = stats.Shots;
                careerStat.ShootingPercentage = stats.ShootingPercentage;

                careerStat.AverageTimeOnIce = stats.AverageTimeOnIce;
                careerStat.FaceoffWinningPercentage =
                    stats.FaceoffWinningPercentage;

                careerStat.Wins = stats.Wins;
                careerStat.Losses = stats.Losses;
                careerStat.OvertimeLosses = stats.OvertimeLosses;
                careerStat.Shutouts = stats.Shutouts;

                careerStat.Saves = stats.Saves;
                careerStat.ShotsAgainst = stats.ShotsAgainst;
                careerStat.SavePercentage = stats.SavePercentage;

                careerStat.GoalsAgainst = stats.GoalsAgainst;
                careerStat.GoalsAgainstAverage =
                    stats.GoalsAgainstAverage;
            }

            foreach (var existingStat in existingStats.Values)
            {
                var stillExists = apiKeys.Contains(
                    (
                        existingStat.Season,
                        existingStat.GameTypeId,
                        existingStat.Sequence
                    ));

                if (!stillExists)
                {
                    _dbContext.PlayerCareerStats.Remove(existingStat);
                }
            }

            await _dbContext.SaveChangesAsync();

            return await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .OrderBy(s => s.Season)
                .ThenBy(s => s.GameTypeId)
                .ThenBy(s => s.Sequence)
                .ToListAsync();
        }

        public async Task SyncCareerStatsFromLandingAsync(
Player player,
NhlPlayerResponse nhlPlayer)
        {
            var existingStats = await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .ToDictionaryAsync(
                    s => (s.Season, s.GameTypeId, s.Sequence));

            var apiKeys = nhlPlayer.SeasonTotals
                .Select(s => (s.Season, s.GameTypeId, s.Sequence))
                .ToHashSet();

            foreach (var stats in nhlPlayer.SeasonTotals)
            {
                var key = (
                    stats.Season,
                    stats.GameTypeId,
                    stats.Sequence);

                if (!existingStats.TryGetValue(
                        key,
                        out var careerStat))
                {
                    careerStat = new PlayerCareerStat
                    {
                        PlayerId = player.Id,
                        Season = stats.Season,
                        GameTypeId = stats.GameTypeId,
                        Sequence = stats.Sequence
                    };

                    _dbContext.PlayerCareerStats.Add(careerStat);

                    existingStats[key] = careerStat;
                }

                careerStat.LeagueAbbreviation = stats.LeagueAbbrev;
                careerStat.TeamName = stats.TeamName?.Default;

                careerStat.GamesPlayed = stats.GamesPlayed;
                careerStat.GamesStarted = stats.GamesStarted;

                careerStat.Goals = stats.Goals;
                careerStat.Assists = stats.Assists;
                careerStat.Points = stats.Points;

                careerStat.PlusMinus = stats.PlusMinus;
                careerStat.PenaltyMinutes = stats.PenaltyMinutes;

                careerStat.PowerPlayGoals = stats.PowerPlayGoals;
                careerStat.PowerPlayPoints = stats.PowerPlayPoints;

                careerStat.ShorthandedGoals = stats.ShorthandedGoals;
                careerStat.ShorthandedPoints = stats.ShorthandedPoints;

                careerStat.GameWinningGoals = stats.GameWinningGoals;
                careerStat.OvertimeGoals = stats.OvertimeGoals;

                careerStat.Shots = stats.Shots;
                careerStat.ShootingPercentage = stats.ShootingPercentage;

                careerStat.AverageTimeOnIce = stats.AverageTimeOnIce;
                careerStat.FaceoffWinningPercentage =
                    stats.FaceoffWinningPercentage;

                careerStat.Wins = stats.Wins;
                careerStat.Losses = stats.Losses;
                careerStat.OvertimeLosses = stats.OvertimeLosses;
                careerStat.Shutouts = stats.Shutouts;

                careerStat.Saves = stats.Saves;
                careerStat.ShotsAgainst = stats.ShotsAgainst;
                careerStat.SavePercentage = stats.SavePercentage;

                careerStat.GoalsAgainst = stats.GoalsAgainst;
                careerStat.GoalsAgainstAverage =
                    stats.GoalsAgainstAverage;
            }

            foreach (var existingStat in existingStats.Values)
            {
                var stillExists = apiKeys.Contains(
                    (
                        existingStat.Season,
                        existingStat.GameTypeId,
                        existingStat.Sequence
                    ));

                if (!stillExists)
                {
                    _dbContext.PlayerCareerStats.Remove(existingStat);
                }
            }
        }
    }
}
