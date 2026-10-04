using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using System;
using System.Diagnostics;
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

        /// <summary>
        /// Fetches one season of NHL game logs for a player.
        /// gameType is 2 for regular season (default) and 3 for playoffs.
        /// </summary>
        public async Task<NhlPlayerGameLogResponse?> GetPlayerGameLogAsync(
            int nhlPlayerId,
            int seasonCode,
            int gameType = 2)
        {
            var url =
                $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/game-log/{seasonCode}/{gameType}";

            return await _httpClient.GetFromJsonAsync<NhlPlayerGameLogResponse>(url);
        }

        /// <summary>
        /// Upserts one player's game logs for one season, then recomputes
        /// his PlayerSeasonStat (FantasyPoints + HatTricks).
        ///
        /// Fantasy points per game:
        ///   Skater: 1 point per G/A, +3 bonus for a hat trick (3+ goals).
        ///   Goalie: 2 per win, 1 per overtime loss, 3 per shutout, plus
        ///   any G/A the goalie recorded.
        /// </summary>
        ///
        /// The optional <paramref name="preloadedTeams"/> dictionary lets a
        /// batch caller (refresh-all, backfill-all) avoid re-querying the
        /// same NhlTeams table for every player. When null, the teams are
        /// loaded once from the database with AsNoTracking.
        /// </summary>
        public async Task<int> SavePlayerGameLogsAsync(
            int nhlPlayerId,
            int seasonCode,
            int gameType = 2,
            Dictionary<string, NhlTeam>? preloadedTeams = null)
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
                .AsNoTracking()
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return 0;
            }

            var gameLogResponse =
                await GetPlayerGameLogAsync(nhlPlayerId, seasonCode, gameType);

            if (gameLogResponse == null)
            {
                return 0;
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            // ---------------------------------------------------------
            // Teams lookup: reuse the caller's dictionary when provided.
            // Fallback path (single-player call) loads once with
            // AsNoTracking since we only read from these rows.
            // ---------------------------------------------------------

            Dictionary<string, NhlTeam> teamsByAbbreviation;

            if (preloadedTeams != null)
            {
                teamsByAbbreviation = preloadedTeams;
            }
            else
            {
                var teams = await _dbContext.NhlTeams
                    .AsNoTracking()
                    .ToListAsync();

                teamsByAbbreviation = teams
                    .ToDictionary(
                        t => t.Abbreviation,
                        StringComparer.OrdinalIgnoreCase);
            }

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
                    // League rule: a hat trick is worth a +3 bonus.
                    fantasyPoints += 3;
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
                    // League rule: a shutout is worth a +3 bonus.
                    fantasyPoints += 3;
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
                        Saves = game.ShotsAgainst - game.GoalsAgainst,
                        SavePercentage = game.SavePercentage,
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
                    existingLog.Saves = game.ShotsAgainst - game.GoalsAgainst;
                    existingLog.SavePercentage = game.SavePercentage;
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
                .AsNoTracking()
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return 0;
            }

            var season = await _dbContext.Seasons
                .AsNoTracking()
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

            var season = await _dbContext.Seasons
                .AsNoTracking()
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

            // Load the team lookup ONCE for the whole run instead of
            // re-querying it inside SavePlayerGameLogsAsync per player.
            var allTeams = await _dbContext.NhlTeams
                .AsNoTracking()
                .ToListAsync(ct);

            var teamsByAbbreviation = allTeams
                .ToDictionary(
                    t => t.Abbreviation,
                    StringComparer.OrdinalIgnoreCase);

            var players = await _dbContext.Players
                .AsNoTracking()
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

            var playersWithLogs = (await _dbContext.PlayerGameLogs
                .AsNoTracking()
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
                            seasonCode,
                            2,
                            teamsByAbbreviation);

                    result.PlayersProcessed++;
                    result.TotalGamesSaved += saved;

                    if (saved == 0)
                    {
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

                // Release every tracked entity from this iteration before
                // moving to the next player. Without this, the scoped
                // DbContext accumulates thousands of tracked entities
                // over a full run and memory climbs linearly.
                _dbContext.ChangeTracker.Clear();

                if (delayMsBetweenPlayers > 0)
                {
                    await Task.Delay(delayMsBetweenPlayers, ct);
                }
            }

            return result;
        }

        /// <summary>
        /// Refreshes the current season's regular-season game logs for
        /// every player in the database, then recomputes each player's
        /// PlayerSeasonStat for that season.
        ///
        /// For each player:
        ///   1. Call SavePlayerAsync — this hits the NHL landing page,
        ///      updates the Player row, syncs PlayerCareerStat, and
        ///      writes the landing-owned columns on PlayerSeasonStat
        ///      for the current season (GP, G, A, Pts, +/-, PIM, PPG,
        ///      PPP, GWG, SOG, SH%, W, L, OTL, SO, SV, SA, SV%, GA, GAA).
        ///   2. Call SavePlayerGameLogsAsync for gameType = 2, which
        ///      upserts one PlayerGameLog per game (idempotent on
        ///      NhlGameId) and then calls UpdatePlayerSeasonStatsAsync
        ///      to fill FantasyPoints and HatTricks from the logs.
        ///
        /// Safe to call repeatedly during the season: existing game logs
        /// are refreshed, new games are appended, and no rows are
        /// duplicated. Other seasons are not touched.
        ///
        /// Optional skip/take let callers chunk the work into smaller
        /// batches (useful when running from a browser that cannot wait
        /// for a 45-minute response). When take is 0, the whole player
        /// list is processed. The optional progress context receives
        /// live counter updates for the polling UI.
        /// </summary>
        public async Task<RefreshSeasonGameLogsResult> RefreshCurrentSeasonForAllPlayersAsync(
            int seasonCode,
            int delayMsBetweenPlayers = 500,
            int skip = 0,
            int take = 0,
            NhlFantasyLeague.api.Services.Jobs.BackgroundJobContext? progress = null,
            CancellationToken ct = default)
        {
            var result = new RefreshSeasonGameLogsResult
            {
                SeasonCode = seasonCode
            };

            var season = await _dbContext.Seasons
                .AsNoTracking()
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

            // Load the team lookup ONCE for the whole run.
            var allTeams = await _dbContext.NhlTeams
                .AsNoTracking()
                .ToListAsync(ct);

            var teamsByAbbreviation = allTeams
                .ToDictionary(
                    t => t.Abbreviation,
                    StringComparer.OrdinalIgnoreCase);

            var playersQuery = _dbContext.Players
                .AsNoTracking()
                .OrderBy(p => p.Id)
                .Select(p => new
                {
                    p.Id,
                    p.NhlPlayerId,
                    p.FirstName,
                    p.LastName
                });

            if (take > 0)
            {
                playersQuery = playersQuery.Skip(skip).Take(take);
            }

            var players = await playersQuery.ToListAsync(ct);

            result.TotalPlayers = players.Count;

            if (progress != null)
            {
                progress.ProgressTotal = players.Count;
                progress.ProgressCurrent = 0;
                progress.Message = $"Processing {players.Count} players...";
            }

            foreach (var player in players)
            {
                ct.ThrowIfCancellationRequested();

                if (progress != null)
                {
                    progress.ProgressCurrent++;
                    progress.Message =
                        $"Processing {player.FirstName} {player.LastName} " +
                        $"({progress.ProgressCurrent}/{progress.ProgressTotal})";
                }

                if (player.NhlPlayerId <= 0)
                {
                    result.SkippedNoNhlId++;
                    continue;
                }

                try
                {
                    // 1. Landing page → Player + PlayerCareerStat +
                    //    landing-owned columns on PlayerSeasonStat.
                    await _playerService.SavePlayerAsync(player.NhlPlayerId);

                    // 2. Regular-season game logs → PlayerGameLog rows
                    //    + FantasyPoints / HatTricks on PlayerSeasonStat.
                    var saved =
                        await SavePlayerGameLogsAsync(
                            player.NhlPlayerId,
                            seasonCode,
                            2,
                            teamsByAbbreviation);

                    result.PlayersProcessed++;
                    result.TotalGamesSaved += saved;

                    var totalInDb =
                        await CountPlayerGameLogsAsync(
                            player.NhlPlayerId,
                            seasonCode);

                    if (totalInDb == 0)
                    {
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

                // Release every tracked entity from this iteration before
                // moving to the next player. This keeps memory flat over
                // a 2,500-player run instead of climbing linearly.
                _dbContext.ChangeTracker.Clear();

                if (delayMsBetweenPlayers > 0)
                {
                    await Task.Delay(delayMsBetweenPlayers, ct);
                }
            }

            // Recompute every fantasy team's season total from scratch
            // using the freshly refreshed game logs and the append-only
            // roster status history. Runs even when some players failed:
            // the recompute is idempotent, and a partial refresh just
            // means the totals reflect whatever game logs we currently
            // have.
            try
            {
                var totals = await RecomputeTeamSeasonTotalsAsync(
                    seasonCode, ct);

                result.TeamTotals = totals;
            }
            catch (Exception ex)
            {
                result.Errors.Add(
                    $"Team totals recompute failed: " +
                    $"{ex.GetType().Name}: {ex.Message}");
            }

            return result;
        }

        /// <summary>
        /// Returns a dictionary keyed on FantasyTeamId containing the
        /// total FP credited to each team from games that started on
        /// the given calendar day (UTC).
        ///
        /// Uses the same "effective RosterStatusHistory row at game
        /// day 00:00 UTC" logic as the season-total recompute, so a
        /// trade mid-season slices cleanly. Only games on the exact
        /// date are counted, which means a game that starts late on
        /// that day and finishes after midnight is still attributed
        /// to the day it started (that is how PlayerGameLog.GameDate
        /// is populated).
        ///
        /// Read-only: does not touch FantasyTeamSeason or any other
        /// persisted row.
        /// </summary>
        public async Task<Dictionary<int, int>> ComputeTeamDailyTotalsAsync(
     int seasonCode,
     DateOnly date,
     CancellationToken ct = default,
     List<RosterStatusHistory>? preloadedHistory = null)
        {
            var season = await _dbContext.Seasons
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    s => s.NhlSeasonCode == seasonCode,
                    ct);

            if (season == null)
            {
                return new Dictionary<int, int>();
            }

            // Every game log row on that date. Small projection so EF
            // never tracks it.
            var games = await _dbContext.PlayerGameLogs
                .Where(g =>
                    g.SeasonId == season.Id &&
                    g.GameDate == date)
                .Select(g => new
                {
                    g.PlayerId,
                    g.FantasyPoints
                })
                .ToListAsync(ct);

            if (games.Count == 0)
            {
                return new Dictionary<int, int>();
            }

            // Whole-season history. Callers that compute totals for several
            // days at once can pass it in to avoid loading the same rows from
            // Neon multiple times.
            var historyRows = preloadedHistory
                ?? await _dbContext.RosterStatusHistories
                    .AsNoTracking()
                    .Where(h => h.SeasonId == season.Id)
                    .OrderBy(h => h.EffectiveAt)
                    .ThenBy(h => h.Id)
                    .ToListAsync(ct);

            var historyByPlayerId = historyRows
                .GroupBy(h => h.PlayerId)
                .ToDictionary(
                    g => g.Key,
                    g => g
                        .OrderBy(h => h.EffectiveAt)
                        .ThenBy(h => h.Id)
                        .ToList());

            // Day-start UTC, matching the granularity used by the
            // season-total recompute.
            var dayStartUtc = new DateTime(
                date.Year,
                date.Month,
                date.Day,
                0, 0, 0,
                DateTimeKind.Utc);

            var totals = new Dictionary<int, int>();

            foreach (var game in games)
            {
                if (!historyByPlayerId.TryGetValue(
                        game.PlayerId,
                        out var playerHistory) ||
                    playerHistory.Count == 0)
                {
                    continue;
                }

                RosterStatusHistory? effective = null;

                for (var i = 0; i < playerHistory.Count; i++)
                {
                    if (playerHistory[i].EffectiveAt <= dayStartUtc)
                    {
                        effective = playerHistory[i];
                    }
                    else
                    {
                        break;
                    }
                }

                if (effective == null ||
                    effective.RosterStatus != RosterStatus.Active)
                {
                    continue;
                }

                totals.TryGetValue(
                    effective.FantasyTeamId,
                    out var current);

                totals[effective.FantasyTeamId] =
                    current + game.FantasyPoints;
            }

            return totals;
        }

        /// <summary>
        /// Recomputes every FantasyTeamSeason aggregate from scratch for
        /// one season, then returns a per-team summary.
        ///
        /// For each PlayerGameLog in the season:
        ///   1. Look up the player's RosterStatusHistory row that was
        ///      effective at the start of the game's calendar day
        ///      (EffectiveAt &lt;= GameDate 00:00 UTC, most recent wins).
        ///   2. If that row's RosterStatus is Active, add the game's
        ///      FantasyPoints to the FantasyTeamSeason row of the team
        ///      on the history row, and route the game's individual
        ///      stats to either the skater or the goalie segment
        ///      depending on the player's position.
        ///   3. Otherwise, drop the game entirely.
        ///
        /// Because history is append-only and includes a row for every
        /// trade (against the new team), the "which team and status at
        /// time T" question is answered by a single ordered lookup with
        /// no special cases.
        ///
        /// Idempotent: every run resets each team's aggregates to 0
        /// first.
        /// </summary>
        public async Task<RecomputeTeamTotalsResult> RecomputeTeamSeasonTotalsAsync(
            int seasonCode,
            CancellationToken ct = default)
        {
            var result = new RecomputeTeamTotalsResult
            {
                SeasonCode = seasonCode
            };

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    s => s.NhlSeasonCode == seasonCode,
                    ct);

            if (season == null)
            {
                result.Errors.Add(
                    $"Season {seasonCode} does not exist in the database.");

                return result;
            }

            // 1. Load every FantasyTeamSeason for the season and zero
            //    every aggregate. Idempotent: the recompute always
            //    starts from zero. THIS list stays tracked because it
            //    is the only thing modified by this method.
            var teamSeasons = await _dbContext.FantasyTeamSeasons
                .Where(fts => fts.SeasonId == season.Id)
                .ToListAsync(ct);

            if (teamSeasons.Count == 0)
            {
                result.Errors.Add(
                    $"No FantasyTeamSeason rows for season {seasonCode}. " +
                    "Run POST /api/League/setup first.");

                return result;
            }

            var teamSeasonByTeamId = teamSeasons
                .ToDictionary(fts => fts.FantasyTeamId);

            result.TeamsProcessed = teamSeasons.Count;

            var now = DateTime.UtcNow;

            foreach (var fts in teamSeasons)
            {
                fts.TotalFantasyPoints = 0;
                fts.TotalFantasyPointsComputedAt = now;

                fts.SkaterGamesPlayed = 0;
                fts.SkaterGoals = 0;
                fts.SkaterAssists = 0;
                fts.SkaterPoints = 0;
                fts.SkaterHatTricks = 0;

                fts.GoalieGamesPlayed = 0;
                fts.GoalieWins = 0;
                fts.GoalieLosses = 0;
                fts.GoalieOvertimeLosses = 0;
                fts.GoalieShutouts = 0;
                fts.GoaliePoints = 0;
            }

            // 2. Load the whole season's history, grouped by player and
            //    sorted by EffectiveAt. History is small (one row per
            //    swap per player, plus one row per trade) and read-only,
            //    so AsNoTracking.
            var historyRows = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h => h.SeasonId == season.Id)
                .ToListAsync(ct);

            var historyByPlayerId = historyRows
                .GroupBy(h => h.PlayerId)
                .ToDictionary(
                    g => g.Key,
                    g => g
                        .OrderBy(h => h.EffectiveAt)
                        .ThenBy(h => h.Id)
                        .ToList());

            // 3. Load every game log row in the season as an anonymous
            //    projection. Because it's projected, EF never tracks it,
            //    so no AsNoTracking call is needed here.
            var games = await _dbContext.PlayerGameLogs
                .Where(g => g.SeasonId == season.Id)
                .Select(g => new
                {
                    g.PlayerId,
                    g.GameDate,
                    g.FantasyPoints,
                    g.Goals,
                    g.Assists,
                    g.Points,
                    g.HatTrick,
                    g.GoalieWin,
                    g.GoalieOvertimeLoss,
                    g.Shutout
                })
                .ToListAsync(ct);

            result.TotalGamesScanned = games.Count;

            // Map PlayerId -> Position, one query. Needed to decide
            // skater vs goalie segment for each game log row. Projected,
            // so tracking is not a concern.
            var playerIds = games
                .Select(g => g.PlayerId)
                .Distinct()
                .ToList();

            var positionsByPlayerId = await _dbContext.Players
                .Where(p => playerIds.Contains(p.Id))
                .Select(p => new { p.Id, p.Position })
                .ToDictionaryAsync(
                    p => p.Id,
                    p => p.Position,
                    ct);

            var playersWithoutHistory = new HashSet<int>();

            foreach (var game in games)
            {
                if (!historyByPlayerId.TryGetValue(
                        game.PlayerId,
                        out var playerHistory) ||
                    playerHistory.Count == 0)
                {
                    playersWithoutHistory.Add(game.PlayerId);
                    continue;
                }

                // GameDate is a DateOnly; EffectiveAt was normalized to
                // 00:00 UTC of the day it was set, so we compare at the
                // same granularity. Games on the same day as a change
                // belong to the pre-change status (EffectiveAt <=
                // game-day-00:00).
                var gameDayUtc = new DateTime(
                    game.GameDate.Year,
                    game.GameDate.Month,
                    game.GameDate.Day,
                    0, 0, 0,
                    DateTimeKind.Utc);

                RosterStatusHistory? effective = null;

                for (var i = 0; i < playerHistory.Count; i++)
                {
                    if (playerHistory[i].EffectiveAt <= gameDayUtc)
                    {
                        effective = playerHistory[i];
                    }
                    else
                    {
                        break;
                    }
                }

                if (effective == null)
                {
                    // Player had no status before this game (e.g. a
                    // game played before the season-start backfill).
                    continue;
                }

                if (effective.RosterStatus != RosterStatus.Active)
                {
                    continue;
                }

                if (!teamSeasonByTeamId.TryGetValue(
                        effective.FantasyTeamId,
                        out var target))
                {
                    // Team exists in history but has no
                    // FantasyTeamSeason row (should not happen; the
                    // setup links every team to the current season).
                    continue;
                }

                target.TotalFantasyPoints += game.FantasyPoints;
                result.GamesCredited++;

                // Route the game's individual stats to the skater or
                // goalie segment. Unknown positions count as skaters on
                // purpose, so no row is ever silently dropped.
                positionsByPlayerId.TryGetValue(
                    game.PlayerId, out var position);

                var group = PositionGroupHelper.Classify(position);

                if (group == PositionGroup.Goalie)
                {
                    target.GoalieGamesPlayed++;
                    target.GoalieWins += game.GoalieWin ? 1 : 0;
                    target.GoalieOvertimeLosses +=
                        game.GoalieOvertimeLoss ? 1 : 0;
                    target.GoalieShutouts += game.Shutout ? 1 : 0;

                    // Regulation loss: the goalie played (a goalie game
                    // log row only exists if he appeared), did not get
                    // the win, and did not get the OT loss.
                    var isLoss =
                        !game.GoalieWin &&
                        !game.GoalieOvertimeLoss;

                    target.GoalieLosses += isLoss ? 1 : 0;

                    // Goalie G + A. For goalies, PlayerGameLog.Points is
                    // stored as Goals + Assists (see SavePlayerGameLogsAsync).
                    target.GoaliePoints += game.Points;
                }
                else
                {
                    target.SkaterGamesPlayed++;
                    target.SkaterGoals += game.Goals;
                    target.SkaterAssists += game.Assists;
                    target.SkaterPoints += game.Points;
                    target.SkaterHatTricks += game.HatTrick ? 1 : 0;
                }
            }

            result.PlayersWithoutHistory = playersWithoutHistory.Count;

            await _dbContext.SaveChangesAsync(ct);

            return result;
        }
    }

    /// <summary>
    /// Summary of a team-total recompute run.
    /// </summary>
    public class RecomputeTeamTotalsResult
    {
        public int SeasonCode { get; set; }

        /// <summary>Number of FantasyTeamSeason rows that were reset and recomputed.</summary>
        public int TeamsProcessed { get; set; }

        /// <summary>Number of PlayerGameLog rows scanned.</summary>
        public int TotalGamesScanned { get; set; }

        /// <summary>Number of PlayerGameLog rows credited to some team (Active at game time).</summary>
        public int GamesCredited { get; set; }

        /// <summary>
        /// Number of players who had games in the season but no history
        /// row at all. They contribute 0. Typically means the
        /// backfill endpoint has not been run yet.
        /// </summary>
        public int PlayersWithoutHistory { get; set; }

        public List<string> Errors { get; set; } = new();
    }

    /// <summary>
    /// Summary of a batch game-log backfill run.
    /// </summary>
    public class BackfillGameLogsResult
    {
        public int SeasonCode { get; set; }

        public int TotalPlayers { get; set; }

        public int PlayersProcessed { get; set; }

        public int SkippedAlreadyBackfilled { get; set; }

        public int SkippedNoNhlId { get; set; }

        public int PlayersWithoutGames { get; set; }

        public int FailedPlayers { get; set; }

        public int TotalGamesSaved { get; set; }

        public List<string> Errors { get; set; } = new();
    }

    /// <summary>
    /// Summary of a current-season game-log refresh run.
    /// </summary>
    public class RefreshSeasonGameLogsResult
    {
        public int SeasonCode { get; set; }
        public int TotalPlayers { get; set; }
        public int PlayersProcessed { get; set; }
        public int SkippedNoNhlId { get; set; }
        public int PlayersWithoutGames { get; set; }
        public int FailedPlayers { get; set; }
        public int TotalGamesSaved { get; set; }
        public List<string> Errors { get; set; } = new();

        /// <summary>
        /// Result of the team-total recompute that runs at the end of
        /// the refresh. Null when the recompute failed hard before it
        /// could produce anything.
        /// </summary>
        public RecomputeTeamTotalsResult? TeamTotals { get; set; }
    }
}