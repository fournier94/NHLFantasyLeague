using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlGameLogService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;
        private readonly NhlPlayerService _playerService;
        private readonly NhlStatsService _nhlStatsService;

        public NhlGameLogService(
            HttpClient httpClient,
            AppDbContext dbContext,
            NhlPlayerService playerService,
            NhlStatsService nhlStatsService)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _playerService = playerService;
            _nhlStatsService = nhlStatsService;
        }

        public async Task<NhlPlayerGameLogResponse?> GetPlayerGameLogAsync(
            int nhlPlayerId,
            int seasonCode)
        {
            var url =
                $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/game-log/{seasonCode}/2";

            return await _httpClient.GetFromJsonAsync<NhlPlayerGameLogResponse>(url);
        }

        public async Task<int> SavePlayerGameLogsAsync(
            int nhlPlayerId,
            int seasonCode)
        {
            var playerResponse = await _playerService.GetPlayerAsync(nhlPlayerId);

            if (playerResponse == null)
            {
                return 0;
            }

            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                player = await _playerService.SavePlayerAsync(nhlPlayerId);
            }

            if (player == null)
            {
                return 0;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return 0;
            }

            var gameLogResponse =
                await GetPlayerGameLogAsync(nhlPlayerId, seasonCode);

            if (gameLogResponse == null)
            {
                return 0;
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            var teams = await _dbContext.NhlTeams
                .ToListAsync();

            var teamsByAbbreviation = teams
                .ToDictionary(
                    t => t.Abbreviation,
                    StringComparer.OrdinalIgnoreCase);

            var existingLogs = await _dbContext.PlayerGameLogs
                .Where(g =>
                    g.PlayerId == player.Id &&
                    g.SeasonId == season.Id)
                .ToListAsync();

            var existingLogsByGameId = existingLogs
                .ToDictionary(g => g.NhlGameId);

            int savedCount = 0;

            foreach (var game in gameLogResponse.GameLog)
            {
                if (!teamsByAbbreviation.TryGetValue(
                        game.TeamAbbreviation,
                        out var nhlTeam))
                {
                    continue;
                }

                if (!teamsByAbbreviation.TryGetValue(
                        game.OpponentAbbreviation,
                        out var opponentTeam))
                {
                    continue;
                }

                bool hatTrick = false;
                bool goalieWin = false;
                bool goalieOTLoss = false;
                bool shutout = false;

                if (isGoalie)
                {
                    goalieWin =
                        string.Equals(
                            game.Decision,
                            "W",
                            StringComparison.OrdinalIgnoreCase);

                    goalieOTLoss =
                        string.Equals(
                            game.Decision,
                            "O",
                            StringComparison.OrdinalIgnoreCase);

                    shutout = game.Shutouts > 0;
                }
                else
                {
                    hatTrick = game.Goals >= 3;
                }

                int points = isGoalie
                    ? game.Goals + game.Assists
                    : game.Points;

                int fantasyPoints = points;

                if (hatTrick)
                {
                    fantasyPoints += 2;
                }

                if (goalieWin)
                {
                    fantasyPoints += 2;
                }

                if (goalieOTLoss)
                {
                    fantasyPoints += 1;
                }

                if (shutout)
                {
                    fantasyPoints += 1;
                }

                if (!existingLogsByGameId.TryGetValue(
                        game.GameId,
                        out var existingLog))
                {
                    existingLog = new PlayerGameLog
                    {
                        PlayerId = player.Id,
                        SeasonId = season.Id,
                        GameDate = game.GameDate,
                        NhlGameId = game.GameId,
                        NhlTeamId = nhlTeam.NhlTeamId,
                        OpponentNhlTeamId = opponentTeam.NhlTeamId,
                        IsHomeGame = game.HomeRoadFlag == "H",
                        Goals = game.Goals,
                        Assists = game.Assists,
                        Points = points,
                        PenaltyMinutes = game.PenaltyMinutes,
                        PlusMinus = game.PlusMinus,
                        Shots = game.Shots,
                        HatTrick = hatTrick,
                        GoalieWin = goalieWin,
                        GoalieOvertimeLoss = goalieOTLoss,
                        Shutout = shutout,
                        GoalsAgainst = game.GoalsAgainst,
                        ShotsAgainst = game.ShotsAgainst,
                        FantasyPoints = fantasyPoints
                    };

                    _dbContext.PlayerGameLogs.Add(existingLog);
                    savedCount++;
                }
                else
                {
                    existingLog.SeasonId = season.Id;
                    existingLog.GameDate = game.GameDate;
                    existingLog.NhlTeamId = nhlTeam.NhlTeamId;
                    existingLog.OpponentNhlTeamId = opponentTeam.NhlTeamId;
                    existingLog.IsHomeGame = game.HomeRoadFlag == "H";
                    existingLog.Goals = game.Goals;
                    existingLog.Assists = game.Assists;
                    existingLog.Points = points;
                    existingLog.PenaltyMinutes = game.PenaltyMinutes;
                    existingLog.PlusMinus = game.PlusMinus;
                    existingLog.Shots = game.Shots;
                    existingLog.HatTrick = hatTrick;
                    existingLog.GoalieWin = goalieWin;
                    existingLog.GoalieOvertimeLoss = goalieOTLoss;
                    existingLog.Shutout = shutout;
                    existingLog.GoalsAgainst = game.GoalsAgainst;
                    existingLog.ShotsAgainst = game.ShotsAgainst;
                    existingLog.FantasyPoints = fantasyPoints;
                }
            }

            await _dbContext.SaveChangesAsync();

            await _nhlStatsService.UpdatePlayerSeasonStatsAsync(
                nhlPlayerId,
                seasonCode);

            return savedCount;
        }

        /// <summary>
        /// Returns how many PlayerGameLog rows exist for one player and
        /// one season. Used by the backfill endpoint so a caller can tell
        /// "the NHL API returned no games" (0 saved, 0 in DB) from "the
        /// games were already saved" (0 saved, N in DB).
        /// </summary>
        public async Task<int> CountPlayerGameLogsAsync(
            int nhlPlayerId,
            int seasonCode)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return 0;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return 0;
            }

            return await _dbContext.PlayerGameLogs
                .CountAsync(g =>
                    g.PlayerId == player.Id &&
                    g.SeasonId == season.Id);
        }

        /// <summary>
        /// Backfills a single season of NHL game logs for every player in
        /// the database. Only NHL games are fetched (that is all the NHL
        /// game-log endpoint returns for a season).
        ///
        /// Behavior:
        ///   - Players with no NHL player id are skipped.
        ///   - Players who already have at least one game-log row for the
        ///     season are skipped, so the run is safe to re-run and
        ///     resumes where it left off.
        ///   - A delay is applied between players to stay polite with the
        ///     public NHL API. Default is 500 ms, matching the population
        ///     batch in NhlPlayerService.
        ///
        /// Returns a summary of the run.
        /// </summary>
        public async Task<BackfillGameLogsResult> BackfillAllPlayersGameLogsAsync(
            int seasonCode,
            int delayMsBetweenPlayers = 500,
            CancellationToken ct = default)
        {
            var result = new BackfillGameLogsResult
            {
                SeasonCode = seasonCode
            };

            // Find the season row once. If it doesn't exist, creating
            // game logs is impossible: PlayerGameLog needs a SeasonId.
            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(
                    s => s.NhlSeasonCode == seasonCode,
                    ct);

            if (season == null)
            {
                result.Errors.Add(
                    $"Season {seasonCode} does not exist in the database. " +
                    "Create it first (League setup or a stats sync).");

                return result;
            }

            // Load the list of players we need to process. Project only
            // what we need so we do not pull the whole entity graph.
            var players = await _dbContext.Players
                .OrderBy(p => p.Id)
                .Select(p => new
                {
                    p.Id,
                    p.NhlPlayerId,
                    p.FirstName,
                    p.LastName
                })
                .ToListAsync(ct);

            result.TotalPlayers = players.Count;

            // Preload which players already have game logs for this
            // season, so we can skip them cheaply.
            var playersWithLogs = (await _dbContext.PlayerGameLogs
                .Where(g => g.SeasonId == season.Id)
                .Select(g => g.PlayerId)
                .Distinct()
                .ToListAsync(ct))
                .ToHashSet();

            foreach (var player in players)
            {
                ct.ThrowIfCancellationRequested();

                if (playersWithLogs.Contains(player.Id))
                {
                    result.SkippedAlreadyBackfilled++;
                    continue;
                }

                if (player.NhlPlayerId <= 0)
                {
                    result.SkippedNoNhlId++;
                    continue;
                }

                try
                {
                    var saved =
                        await SavePlayerGameLogsAsync(
                            player.NhlPlayerId,
                            seasonCode);

                    result.PlayersProcessed++;
                    result.TotalGamesSaved += saved;

                    if (saved == 0)
                    {
                        // The NHL API returned no games for this player
                        // and season. That's common for players who did
                        // not play in the NHL that year.
                        result.PlayersWithoutGames++;
                    }
                }
                catch (Exception ex)
                {
                    result.FailedPlayers++;

                    result.Errors.Add(
                        $"{player.NhlPlayerId} " +
                        $"({player.FirstName} {player.LastName}): " +
                        $"{ex.GetType().Name}: {ex.Message}");
                }

                if (delayMsBetweenPlayers > 0)
                {
                    await Task.Delay(delayMsBetweenPlayers, ct);
                }
            }

            return result;
        }
    }

    /// <summary>
    /// Summary of a batch game-log backfill run.
    /// </summary>
    public class BackfillGameLogsResult
    {
        public int SeasonCode { get; set; }

        /// <summary>Total players in the database at the start of the run.</summary>
        public int TotalPlayers { get; set; }

        /// <summary>Players actually queried from the NHL API.</summary>
        public int PlayersProcessed { get; set; }

        /// <summary>Players skipped because they already had game logs for this season.</summary>
        public int SkippedAlreadyBackfilled { get; set; }

        /// <summary>Players skipped because they had no NHL player id.</summary>
        public int SkippedNoNhlId { get; set; }

        /// <summary>Players queried but the NHL API returned no games.</summary>
        public int PlayersWithoutGames { get; set; }

        /// <summary>Players whose fetch threw an exception.</summary>
        public int FailedPlayers { get; set; }

        /// <summary>Sum of new PlayerGameLog rows written across all players.</summary>
        public int TotalGamesSaved { get; set; }

        /// <summary>Human-readable errors, one per failed player.</summary>
        public List<string> Errors { get; set; } = new();
    }
}