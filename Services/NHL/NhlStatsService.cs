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

        /// <summary>
        /// Saves every regular-season and playoff row from the NHL API
        /// season totals into PlayerSeasonStat, across all leagues. Rows are
        /// unique per (PlayerId, SeasonId, LeagueAbbreviation, GameTypeId) and
        /// a mid-season trade (several Sequence values) is summed into one row.
        /// </summary>
        public async Task<int> SavePlayerSeasonStatsAsync(
            Player player,
            List<NhlSeasonTotal> seasonTotals)
        {
            // Regular season (2) and playoffs (3); everything else (preseason,
            // all-star, etc.) is ignored.
            var relevant = seasonTotals
                .Where(s => s.GameTypeId == 2 || s.GameTypeId == 3)
                .ToList();

            if (relevant.Count == 0)
            {
                return 0;
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            var savedCount = 0;

            // Sum Sequence rows (mid-season trades) per (season, league, game type).
            var grouped = relevant
                .GroupBy(s => new
                {
                    s.Season,
                    League = string.IsNullOrWhiteSpace(s.LeagueAbbrev)
                        ? "NHL"
                        : s.LeagueAbbrev,
                    s.GameTypeId
                });

            foreach (var group in grouped)
            {
                var season = await _dbContext.Seasons
                    .FirstOrDefaultAsync(s =>
                        s.NhlSeasonCode == group.Key.Season);

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
                            $"skipping season {group.Key.Season}.");
                        continue;
                    }

                    var seasonStartYear = group.Key.Season / 10000;
                    var seasonEndYear = group.Key.Season % 10000;

                    season = new Season
                    {
                        Name = $"{seasonStartYear}-{(seasonEndYear % 100).ToString("D2")}",
                        StartDate = new DateOnly(seasonStartYear, 10, 1),
                        EndDate = new DateOnly(seasonEndYear, 6, 30),
                        SalaryCap = 0,
                        SalaryFloor = 0,
                        NhlSeasonCode = group.Key.Season,
                        LeagueId = league.Id
                    };

                    _dbContext.Seasons.Add(season);
                    await _dbContext.SaveChangesAsync();
                }

                // Sum the values across the group's sequences.
                var gamesPlayed = group.Sum(s => s.GamesPlayed);
                var goals = group.Sum(s => s.Goals);
                var assists = group.Sum(s => s.Assists);

                // NHL seasonTotals provides a Points value for skaters.
                // For goalies, the NHL response does not provide a Points field,
                // so we calculate points from their goals and assists.
                int points = isGoalie
                    ? goals + assists
                    : group.Sum(s => s.Points);

                var shotsAgainst = group.Sum(s => s.ShotsAgainst);
                var goalsAgainst = group.Sum(s => s.GoalsAgainst);

                // Team name: pick the first non-empty one in the group. For a
                // mid-season trade this shows the first team; the full split is
                // still visible in PlayerCareerStat.
                var teamName = group
                    .Select(s => s.TeamName?.Default)
                    .FirstOrDefault(t => !string.IsNullOrWhiteSpace(t));

                var existingStats = await _dbContext.PlayerSeasonStats
                    .FirstOrDefaultAsync(s =>
                        s.PlayerId == player.Id &&
                        s.SeasonId == season.Id &&
                        s.LeagueAbbreviation == group.Key.League &&
                        s.GameTypeId == group.Key.GameTypeId);

                if (existingStats == null)
                {
                    var playerStats = new PlayerSeasonStat
                    {
                        PlayerId = player.Id,
                        SeasonId = season.Id,
                        LeagueAbbreviation = group.Key.League,
                        TeamName = teamName,
                        GameTypeId = group.Key.GameTypeId,
                        GamesPlayed = gamesPlayed,
                        Goals = goals,
                        Assists = assists,
                        Points = points,
                        PlusMinus = group.Sum(s => s.PlusMinus),
                        PenaltyMinutes = group.Sum(s => s.PenaltyMinutes),
                        PowerPlayGoals = group.Sum(s => s.PowerPlayGoals),
                        PowerPlayPoints = group.Sum(s => s.PowerPlayPoints),
                        GameWinningGoals = group.Sum(s => s.GameWinningGoals),
                        Shots = group.Sum(s => s.Shots),
                        ShootingPercentage = group.Sum(s => s.ShootingPercentage),
                        GoalsAgainst = goalsAgainst,
                        Wins = group.Sum(s => s.Wins),
                        Losses = group.Sum(s => s.Losses),
                        OvertimeLosses = group.Sum(s => s.OvertimeLosses),
                        Shutouts = group.Sum(s => s.Shutouts),
                        HatTricks = 0,
                        Saves = shotsAgainst - goalsAgainst,
                        ShotsAgainst = shotsAgainst,
                        SavePercentage = group.Sum(s => s.SavePercentage),
                        GoalsAgainstAverage = group.Sum(s => s.GoalsAgainstAverage)
                    };

                    _dbContext.PlayerSeasonStats.Add(playerStats);
                    savedCount++;
                }
                else
                {
                    existingStats.TeamName = teamName;
                    existingStats.GamesPlayed = gamesPlayed;
                    existingStats.Goals = goals;
                    existingStats.Assists = assists;
                    existingStats.Points = points;
                    existingStats.PlusMinus = group.Sum(s => s.PlusMinus);
                    existingStats.PenaltyMinutes = group.Sum(s => s.PenaltyMinutes);
                    existingStats.PowerPlayGoals = group.Sum(s => s.PowerPlayGoals);
                    existingStats.PowerPlayPoints = group.Sum(s => s.PowerPlayPoints);
                    existingStats.GameWinningGoals = group.Sum(s => s.GameWinningGoals);
                    existingStats.Shots = group.Sum(s => s.Shots);
                    existingStats.ShootingPercentage = group.Sum(s => s.ShootingPercentage);
                    existingStats.GoalsAgainst = goalsAgainst;
                    existingStats.Wins = group.Sum(s => s.Wins);
                    existingStats.Losses = group.Sum(s => s.Losses);
                    existingStats.OvertimeLosses = group.Sum(s => s.OvertimeLosses);
                    existingStats.Shutouts = group.Sum(s => s.Shutouts);
                    existingStats.Saves = shotsAgainst - goalsAgainst;
                    existingStats.ShotsAgainst = shotsAgainst;
                    existingStats.SavePercentage = group.Sum(s => s.SavePercentage);
                    existingStats.GoalsAgainstAverage = group.Sum(s => s.GoalsAgainstAverage);
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
