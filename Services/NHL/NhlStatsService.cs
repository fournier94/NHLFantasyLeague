using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
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
        /// Writes one fantasy row per (PlayerId, SeasonId) for the current
        /// season only, using the NHL regular season totals from the
        /// landing page. Used by the batch population.
        /// </summary>
        public async Task<int> UpsertFantasySeasonStatAsync(
    Player player,
    NhlPlayerResponse nhlPlayer)
        {
            var featured = nhlPlayer.FeaturedStats;

            if (featured == null || featured.Season == 0)
            {
                return 0;
            }

            var stats = featured.RegularSeason?.SubSeason;

            if (stats == null)
            {
                return 0;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == featured.Season);

            if (season == null)
            {
                return 0;
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            int points = isGoalie
                ? stats.Goals + stats.Assists
                : stats.Points;

            var existing = await _dbContext.PlayerSeasonStats
                .FirstOrDefaultAsync(s =>
                    s.PlayerId == player.Id &&
                    s.SeasonId == season.Id);

            if (existing == null)
            {
                existing = new PlayerSeasonStat
                {
                    PlayerId = player.Id,
                    SeasonId = season.Id
                };

                _dbContext.PlayerSeasonStats.Add(existing);
            }

            // Regular-season totals, sourced from the landing page.
            existing.GamesPlayed = stats.GamesPlayed;
            existing.Goals = stats.Goals;
            existing.Assists = stats.Assists;
            existing.Points = points;
            existing.PlusMinus = stats.PlusMinus;
            existing.PenaltyMinutes = stats.PenaltyMinutes;
            existing.PowerPlayGoals = stats.PowerPlayGoals;
            existing.PowerPlayPoints = stats.PowerPlayPoints;
            existing.GameWinningGoals = stats.GameWinningGoals;
            existing.Shots = stats.Shots;
            existing.ShootingPercentage = stats.ShootingPercentage;

            // Goalie totals.
            existing.Wins = stats.Wins;
            existing.Losses = stats.Losses;
            existing.OvertimeLosses = stats.OvertimeLosses;
            existing.Shutouts = stats.Shutouts;
            existing.Saves = stats.Saves;
            existing.ShotsAgainst = stats.ShotsAgainst;
            existing.SavePercentage = stats.SavePercentage;
            existing.GoalsAgainst = stats.GoalsAgainst;
            existing.GoalsAgainstAverage = stats.GoalsAgainstAverage;

            // FantasyPoints and HatTricks are NOT written here. They are
            // owned by UpdatePlayerSeasonStatsAsync, which computes them
            // from PlayerGameLog rows. Keeping the writers separated means
            // re-running either one never clobbers the other.

            await _dbContext.SaveChangesAsync();

            return 1;
        }

        public async Task<List<CareerStatDto>?> GetPlayerCareerStatsAsync(int nhlPlayerId)
        {
            var player = await _dbContext.Players
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return null;
            }

            return await _dbContext.PlayerCareerStats
                .AsNoTracking()
                .Where(s => s.PlayerId == player.Id)
                .OrderByDescending(s => s.Season)
                .ThenBy(s => s.GameTypeId)
                .ThenBy(s => s.Sequence)
                .Select(s => new CareerStatDto
                {
                    Season = s.Season,
                    GameTypeId = s.GameTypeId,
                    Sequence = s.Sequence,
                    LeagueAbbreviation = s.LeagueAbbreviation,
                    TeamName = s.TeamName,
                    GamesPlayed = s.GamesPlayed,
                    GamesStarted = s.GamesStarted,
                    Goals = s.Goals,
                    Assists = s.Assists,
                    Points = s.Points,
                    PlusMinus = s.PlusMinus,
                    PenaltyMinutes = s.PenaltyMinutes,
                    PowerPlayGoals = s.PowerPlayGoals,
                    PowerPlayPoints = s.PowerPlayPoints,
                    ShorthandedGoals = s.ShorthandedGoals,
                    ShorthandedPoints = s.ShorthandedPoints,
                    GameWinningGoals = s.GameWinningGoals,
                    OvertimeGoals = s.OvertimeGoals,
                    Shots = s.Shots,
                    ShootingPercentage = s.ShootingPercentage,
                    AverageTimeOnIce = s.AverageTimeOnIce,
                    FaceoffWinningPercentage = s.FaceoffWinningPercentage,
                    Wins = s.Wins,
                    Losses = s.Losses,
                    OvertimeLosses = s.OvertimeLosses,
                    Shutouts = s.Shutouts,
                    Saves = s.Saves,
                    ShotsAgainst = s.ShotsAgainst,
                    SavePercentage = s.SavePercentage,
                    GoalsAgainst = s.GoalsAgainst,
                    GoalsAgainstAverage = s.GoalsAgainstAverage
                })
                .ToListAsync();
        }

        public async Task<PlayerSeasonStat?> GetPlayerSeasonStatsAsync(
            int nhlPlayerId,
            int seasonCode)
        {
            var player = await _dbContext.Players
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return null;
            }

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return null;
            }

            return await _dbContext.PlayerSeasonStats
                .AsNoTracking()
                .FirstOrDefaultAsync(s =>
                    s.PlayerId == player.Id &&
                    s.SeasonId == season.Id);
        }

        public async Task UpdatePlayerSeasonStatsAsync(
            int nhlPlayerId,
            int seasonCode)
        {
            var player = await _dbContext.Players
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return;
            }

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return;
            }

            // We only read these rows to sum FantasyPoints and count
            // hat-tricks, so no tracking is needed. AsNoTracking keeps
            // EF from building identity maps and snapshots over the
            // ~82 rows per player.
            var logs = await _dbContext.PlayerGameLogs
                .AsNoTracking()
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

            seasonStats.FantasyPoints =
                logs.Sum(g => g.FantasyPoints);

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

            // SAFETY: only prune stale rows when the API response is
            // plausibly complete. The NHL API rate-limits and can
            // return partial or empty seasonTotals under load. Without
            // this guard, a single partial response would wipe a
            // player's entire career history. If the API returned
            // fewer rows than we currently have, treat it as
            // incomplete and keep the DB rows untouched. Stale rows
            // are harmless; missing rows are not.
            if (apiKeys.Count >= existingStats.Count)
            {
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

            await _dbContext.SaveChangesAsync();

            return await _dbContext.PlayerCareerStats
                .AsNoTracking()
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

            // SAFETY: see SyncPlayerCareerStatsAsync for the full
            // rationale. Short version: a partial or empty API
            // response must never cause a mass delete of career
            // history. Only prune when the API response is at least
            // as large as what we currently have.
            if (apiKeys.Count >= existingStats.Count)
            {
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

        /// <summary>
        /// Backfills the hat-trick count on every NHL PlayerCareerStat row
        /// in the database. For each (player, season, game type) triple,
        /// it fetches the NHL game log, counts the games with 3+ goals,
        /// and writes the count onto the matching career row.
        ///
        /// Only NHL rows are touched: rows whose LeagueAbbreviation is not
        /// "NHL" are ignored, and the game-log endpoint only serves NHL
        /// games anyway.
        ///
        /// Multi-sequence seasons (mid-season trades) get the whole season
        /// total on their lowest Sequence row, and 0 on the other rows, so
        /// summing the column never double-counts.
        ///
        /// Rows whose HatTricksComputedAt is already set are skipped, so
        /// the run is safe to re-run and resumes where it left off. Pass
        /// force = true to recompute them.
        ///
        /// Nothing is written to PlayerGameLog: this method only fills the
        /// HatTricks column on PlayerCareerStat.
        /// </summary>
        public async Task<BackfillCareerHatTricksResult> BackfillCareerHatTricksAsync(
          int delayMsBetweenCalls = 500,
          bool force = false,
          NhlFantasyLeague.api.Services.Jobs.BackgroundJobContext? progress = null,
          CancellationToken ct = default)
        {
            var result = new BackfillCareerHatTricksResult();

            // Load every NHL career row we might need to touch. We only
            // need the fields required to group rows and write the result.
            var query = _dbContext.PlayerCareerStats
                .AsNoTracking()
                .Where(r => r.LeagueAbbreviation == "NHL");

            if (!force)
            {
                query = query.Where(r => r.HatTricksComputedAt == null);
            }

            var candidateRows = await query
                .Select(r => new
                {
                    r.Id,
                    r.PlayerId,
                    r.Season,
                    r.GameTypeId,
                    r.Sequence
                })
                .ToListAsync(ct);

            result.TotalRows = candidateRows.Count;

            if (result.TotalRows == 0)
            {
                return result;
            }

            // Group rows by (player, season, game type). One API call
            // per group, then the same value gets fanned out to every
            // row in that group.
            var groups = candidateRows
                .GroupBy(r => new { r.PlayerId, r.Season, r.GameTypeId })
                .ToList();

            result.TotalGroups = groups.Count;

            if (progress != null)
            {
                progress.ProgressTotal = groups.Count;
                progress.ProgressCurrent = 0;
            }

            // Get every player's NHL id in one query, so we do not hit
            // the DB inside the loop.
            var playerIds = groups
                .Select(g => g.Key.PlayerId)
                .Distinct()
                .ToList();

            var nhlIdByPlayerId = await _dbContext.Players
                .AsNoTracking()
                .Where(p => playerIds.Contains(p.Id))
                .Select(p => new { p.Id, p.NhlPlayerId })
                .ToDictionaryAsync(
                    p => p.Id,
                    p => p.NhlPlayerId,
                    ct);

            var now = DateTime.UtcNow;

            // Collect all row ids we touched so we can load and update
            // them in one final SaveChangesAsync.
            var rowsToUpdate = new List<(int RowId, int? HatTricks)>();

            foreach (var group in groups)
            {
                ct.ThrowIfCancellationRequested();

                if (progress != null)
                {
                    progress.ProgressCurrent++;
                    progress.Message = $"Group {progress.ProgressCurrent}/{progress.ProgressTotal}";
                }

                if (!nhlIdByPlayerId.TryGetValue(
                        group.Key.PlayerId,
                        out var nhlPlayerId) ||
                    nhlPlayerId <= 0)
                {
                    result.SkippedNoNhlId++;
                    continue;
                }

                NhlPlayerGameLogResponse? gameLog;

                try
                {
                    gameLog = await _httpClient.GetFromJsonAsync<NhlPlayerGameLogResponse>(
                        $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/game-log/{group.Key.Season}/{group.Key.GameTypeId}",
                        ct);
                }
                catch (Exception ex)
                {
                    result.FailedGroups++;
                    result.Errors.Add(
                        $"Player {nhlPlayerId} season {group.Key.Season} " +
                        $"gameType {group.Key.GameTypeId}: " +
                        $"{ex.GetType().Name}: {ex.Message}");

                    if (delayMsBetweenCalls > 0)
                    {
                        await Task.Delay(delayMsBetweenCalls, ct);
                    }

                    continue;
                }

                if (gameLog == null || gameLog.GameLog.Count == 0)
                {
                    // The API has no game log for this season. Leave the
                    // column null so the UI can show a dash.
                    result.SkippedNoGameLog++;

                    if (delayMsBetweenCalls > 0)
                    {
                        await Task.Delay(delayMsBetweenCalls, ct);
                    }

                    continue;
                }

                var hatTricks = gameLog.GameLog.Count(g => g.Goals >= 3);

                // Write the total on the lowest Sequence row of the group,
                // 0 on the others, so a SUM over the column is correct.
                var orderedRows = group
                    .OrderBy(r => r.Sequence)
                    .ToList();

                for (var i = 0; i < orderedRows.Count; i++)
                {
                    rowsToUpdate.Add(
                        (orderedRows[i].Id, i == 0 ? hatTricks : 0));
                }

                result.GroupsProcessed++;
                result.TotalHatTricksFound += hatTricks;

                if (delayMsBetweenCalls > 0)
                {
                    await Task.Delay(delayMsBetweenCalls, ct);
                }
            }

            // Apply all updates in one pass. These rows must be tracked
            // because we modify and save them.
            var rowIdsToUpdate = rowsToUpdate
                .Select(r => r.RowId)
                .ToHashSet();

            var rows = await _dbContext.PlayerCareerStats
                .Where(r => rowIdsToUpdate.Contains(r.Id))
                .ToListAsync(ct);

            var valueByRowId = rowsToUpdate
                .ToDictionary(r => r.RowId, r => r.HatTricks);

            foreach (var row in rows)
            {
                if (valueByRowId.TryGetValue(row.Id, out var value))
                {
                    row.HatTricks = value;
                    row.HatTricksComputedAt = now;
                    result.RowsUpdated++;
                }
            }

            await _dbContext.SaveChangesAsync(ct);

            return result;
        }
    }

    /// <summary>
    /// Summary of a hat-trick backfill run for PlayerCareerStat.
    /// </summary>
    public class BackfillCareerHatTricksResult
    {
        /// <summary>NHL career rows considered (after the force filter).</summary>
        public int TotalRows { get; set; }

        /// <summary>(Player, season, game type) groups derived from the rows.</summary>
        public int TotalGroups { get; set; }

        /// <summary>Groups whose game log was fetched and counted.</summary>
        public int GroupsProcessed { get; set; }

        /// <summary>Groups skipped because the NHL API returned no game log.</summary>
        public int SkippedNoGameLog { get; set; }

        /// <summary>Groups skipped because the player had no NHL id.</summary>
        public int SkippedNoNhlId { get; set; }

        /// <summary>Groups whose fetch threw an exception.</summary>
        public int FailedGroups { get; set; }

        /// <summary>Career rows actually updated with a new HatTricks value.</summary>
        public int RowsUpdated { get; set; }

        /// <summary>Sum of hat tricks counted across every processed group.</summary>
        public int TotalHatTricksFound { get; set; }

        /// <summary>Human-readable errors, one per failed group.</summary>
        public List<string> Errors { get; set; } = new();
    }
}