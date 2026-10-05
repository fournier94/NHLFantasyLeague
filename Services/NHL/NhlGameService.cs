using System.Net.Http;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services.NHL
{
    /// <summary>
    /// Talks to the public NHL API, keeps the in-memory live cache
    /// fresh, and writes delta-based updates to the database.
    ///
    /// TWO WRITE PATHS
    ///
    ///   RefreshLiveGamesCacheAsync    — called every 7 min during
    ///                                   the live window. Updates the
    ///                                   cache AND writes live deltas
    ///                                   for games that have a boxscore.
    ///
    ///   PersistFinalGamesForDateAsync — the 2:30 AM ET batch. Writes
    ///                                   final deltas for every game
    ///                                   that finished yesterday.
    ///
    /// DECISION STATS ARE DEFERRED UNTIL FINAL
    ///
    /// A goalie's win/loss/OTL/shutout is not known until the final
    /// horn. During live games we write his goals-against, shots,
    /// and saves (those are final once they happen) but not the
    /// decision or shutout bonus. Those are applied on the FINAL tick
    /// and by the post-game write. The delta approach handles the
    /// transition seamlessly: no correction is needed because we
    /// never wrote the wrong value in the first place.
    ///
    /// IDEMPOTENT. Running the live refresh twice in a row with no
    /// boxscore change produces zero DB writes. Running the post-game
    /// write after a live persist produces zero additional writes for
    /// already-persisted stats.
    ///
    /// COST. One wake-up per tick during the live window. Neon stays
    /// awake 5 min per wake-up, so ~70% duty cycle at 7-minute ticks.
    /// Roughly 20-22 CU-hours/month during games, ~33-35 total
    /// including baseline.
    /// </summary>
    public class NhlGameService
    {
        private const string ScheduleNowUrl =
            "https://api-web.nhle.com/v1/schedule/now";

        private const string ScheduleByDateUrlFormat =
            "https://api-web.nhle.com/v1/schedule/{0}";

        private const string BoxscoreUrlFormat =
            "https://api-web.nhle.com/v1/gamecenter/{0}/boxscore";

        /// <summary>
        /// States that get a boxscore fetched. LIVE and CRIT are the
        /// in-progress games; FINAL and OFF are the finished games
        /// (NHL flips FINAL to OFF a few hours after the horn).
        /// </summary>
        private static readonly HashSet<string> BoxscoreStates =
            new(StringComparer.OrdinalIgnoreCase)
            {
                "LIVE",
                "CRIT",
                "FINAL",
                "OFF",
            };

        /// <summary>
        /// States worth persisting on the live tick. FINAL/OFF are
        /// included so a game that just ended gets its decision stats
        /// applied before the 2:30 AM batch, letting the standings
        /// page show the corrected totals the same evening.
        /// </summary>
        private static readonly HashSet<string> PersistableStates =
            new(StringComparer.OrdinalIgnoreCase)
            {
                "LIVE",
                "CRIT",
                "FINAL",
                "OFF",
            };

        private static readonly HashSet<string> FinishedStates =
            new(StringComparer.OrdinalIgnoreCase)
            {
                "FINAL",
                "OFF",
            };

        /// <summary>
        /// Only poll FINAL/OFF boxscores within this window after
        /// start time. Prevents refreshing yesterday's games.
        /// </summary>
        private static readonly TimeSpan FinalGameGraceWindow =
            TimeSpan.FromHours(6);

        // Tracks the last time we fetched each game's boxscore, so the
        // FINAL/OFF polling can back off over time without hitting the
        // API on every tick. Keyed by NHL game id. Small (one entry per
        // game per day) and safe to keep forever.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<long, DateTime>
            _lastBoxscoreFetchUtc = new();

        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public NhlGameService(
            HttpClient httpClient,
            AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
        }

        // =================================================================
        // External API
        // =================================================================

        public async Task<List<NhlScheduleGame>> GetTodayScheduleAsync(
            CancellationToken ct = default)
        {
            var response = await _httpClient
                .GetFromJsonAsync<NhlScheduleResponse>(ScheduleNowUrl, ct);

            if (response == null)
            {
                return new List<NhlScheduleGame>();
            }

            // Return the whole game week. The ShouldAttachBoxscore
            // check downstream filters by state and grace window, so
            // old games get skipped anyway. Including everything is
            // cheap (the schedule is small) and avoids missing a
            // game that started before midnight ET but is still in
            // progress when the tick fires (rare but possible at
            // week boundaries).
            return response.GameWeek
                .SelectMany(w => w.Games)
                .ToList();
        }

        public async Task<List<NhlScheduleGame>> GetScheduleForDateAsync(
            DateOnly date,
            CancellationToken ct = default)
        {
            var url = string.Format(
                ScheduleByDateUrlFormat,
                date.ToString("yyyy-MM-dd"));

            var response = await _httpClient
                .GetFromJsonAsync<NhlScheduleResponse>(url, ct);

            if (response == null)
            {
                return new List<NhlScheduleGame>();
            }

            return response.GameWeek
                .Where(w => w.Date == date)
                .SelectMany(w => w.Games)
                .ToList();
        }

        public async Task<NhlBoxscoreResponse?> GetBoxscoreAsync(
            long gameId,
            CancellationToken ct = default)
        {
            var url = string.Format(BoxscoreUrlFormat, gameId);

            return await _httpClient
                .GetFromJsonAsync<NhlBoxscoreResponse>(url, ct);
        }

        // =================================================================
        // Live refresh — cache + DB persist
        // =================================================================

        /// <summary>
        /// Refreshes the in-memory cache with today's schedule and
        /// every refreshable game's current boxscore, then persists
        /// the deltas for games that are currently live or just
        /// finished.
        ///
        /// Called by the scheduled runner every 7 minutes during the
        /// live window. If no games are in progress, the cache still
        /// updates but no DB writes happen.
        /// </summary>
        public async Task<RefreshLiveCacheResult> RefreshLiveGamesCacheAsync(
            LiveGameCache cache,
            CancellationToken ct = default)
        {
            var result = new RefreshLiveCacheResult();

            // -- 1. Fetch schedule (HTTP) -------------------------------
            var schedule = await GetTodayScheduleAsync(ct);
            result.TotalGamesOnSchedule = schedule.Count;

            if (schedule.Count == 0)
            {
                cache.Replace(Array.Empty<LiveGameSnapshot>());
                return result;
            }

            // -- 2. Fetch boxscores (HTTP) ------------------------------
            var now = DateTime.UtcNow;
            var snapshots = new List<LiveGameSnapshot>(schedule.Count);

            foreach (var game in schedule)
            {
                var snapshot = BuildSnapshot(game);

                if (ShouldAttachBoxscore(game, now))
                {
                    try
                    {
                        var box = await GetBoxscoreAsync(game.Id, ct);

                        if (box != null)
                        {
                            snapshot.Boxscore = box;
                            result.BoxscoresFetched++;
                        }
                    }
                    catch (Exception ex)
                    {
                        result.Errors.Add(
                            $"Game {game.Id} boxscore: " +
                            $"{ex.GetType().Name}: {ex.Message}");
                    }

                    await Task.Delay(200, ct);
                }

                snapshots.Add(snapshot);
            }

            // -- 3. Update cache ---------------------------------------
            cache.Replace(snapshots);
            result.SnapshotCount = snapshots.Count;

            // -- 4. Persist deltas for games worth persisting ----------
            var persistable = snapshots
                .Where(s =>
                    s.Boxscore != null &&
                    PersistableStates.Contains(s.GameState))
                .ToList();

            if (persistable.Count == 0)
            {
                // No live game, or boxscores all failed to fetch.
                return result;
            }

            try
            {
                var persistResult = await PersistSnapshotsAsync(persistable, ct);

                result.GamesPersisted = persistable.Count;
                result.PlayersUpdated = persistResult.GameLogsInserted +
                                        persistResult.GameLogsUpdated;
                result.TeamDelta = persistResult.TotalFantasyPointsDelta;
            }
            catch (Exception ex)
            {
                // Cache update succeeded; persist failed. Log and let
                // the next tick retry with fresh data.
                result.Errors.Add(
                    $"Persist: {ex.GetType().Name}: {ex.Message}");
            }

            return result;
        }

        private static LiveGameSnapshot BuildSnapshot(NhlScheduleGame game)
        {
            return new LiveGameSnapshot
            {
                GameId = game.Id,
                GameDate = game.GameDate,
                Season = game.Season,
                GameType = game.GameType,
                StartTimeUtc = game.StartTimeUtc,
                GameState = game.GameState,
                AwayAbbreviation = game.AwayTeam.Abbreviation,
                HomeAbbreviation = game.HomeTeam.Abbreviation,
                AwayScore = game.AwayTeam.Score,
                HomeScore = game.HomeTeam.Score,
                PeriodNumber = game.PeriodDescriptor?.Number,
                PeriodType = game.PeriodDescriptor?.PeriodType,
                Boxscore = null,
            };
        }

        private static bool ShouldAttachBoxscore(
     NhlScheduleGame game,
     DateTime now)
        {
            if (!BoxscoreStates.Contains(game.GameState))
            {
                return false;
            }

            var isLive = string.Equals(
                    game.GameState, "LIVE", StringComparison.OrdinalIgnoreCase)
                || string.Equals(
                    game.GameState, "CRIT", StringComparison.OrdinalIgnoreCase);

            var minutesSinceStart =
                (now - game.StartTimeUtc).TotalMinutes;

            // LIVE / CRIT: fetch every tick, no backoff.
            if (isLive)
            {
                _lastBoxscoreFetchUtc[game.Id] = now;
                return true;
            }

            // FINAL / OFF: stop fetching entirely once we're past the
            // grace window. Prevents refreshing yesterday's games.
            if (minutesSinceStart > FinalGameGraceWindow.TotalMinutes)
            {
                return false;
            }

            // FINAL / OFF within the grace window. Poll aggressively
            // for the first 3 hours after start (covers the game ending
            // and the immediate post-game corrections), then back off to
            // once every 5 minutes. This keeps the API load flat even
            // though the live tick is now every 60 seconds.
            var minMinutesBetweenFetches =
                minutesSinceStart < 180 ? 1 : 5;

            if (_lastBoxscoreFetchUtc.TryGetValue(game.Id, out var last) &&
                (now - last).TotalMinutes < minMinutesBetweenFetches)
            {
                return false;
            }

            _lastBoxscoreFetchUtc[game.Id] = now;
            return true;
        }

        // =================================================================
        // Post-game write — batch
        // =================================================================

        /// <summary>
        /// Persists the final stats of every FINAL or OFF game for the
        /// given date. One bulk transaction.
        ///
        /// Runs once a night at 2:30 AM ET. Idempotent: running it
        /// twice on the same date does zero writes the second time.
        /// </summary>
        public async Task<PersistFinalGamesResult> PersistFinalGamesForDateAsync(
            DateOnly date,
            CancellationToken ct = default)
        {
            var result = new PersistFinalGamesResult { Date = date };

            var schedule = await GetScheduleForDateAsync(date, ct);

            var finalGames = schedule
                .Where(g => FinishedStates.Contains(g.GameState))
                .ToList();

            result.FinalGamesOnSchedule = finalGames.Count;

            if (finalGames.Count == 0)
            {
                return result;
            }

            var snapshots = new List<LiveGameSnapshot>();

            foreach (var game in finalGames)
            {
                try
                {
                    var box = await GetBoxscoreAsync(game.Id, ct);

                    if (box != null)
                    {
                        var snapshot = BuildSnapshot(game);
                        snapshot.Boxscore = box;
                        snapshots.Add(snapshot);
                    }
                }
                catch (Exception ex)
                {
                    result.Errors.Add(
                        $"Game {game.Id}: " +
                        $"{ex.GetType().Name}: {ex.Message}");
                }

                await Task.Delay(300, ct);
            }

            if (snapshots.Count == 0)
            {
                return result;
            }

            var persistResult = await PersistSnapshotsAsync(snapshots, ct);

            result.GameLogsInserted = persistResult.GameLogsInserted;
            result.GameLogsUpdated = persistResult.GameLogsUpdated;
            result.SeasonStatsInserted = persistResult.SeasonStatsInserted;
            result.TeamSeasonsUpdated = persistResult.TeamSeasonsUpdated;
            result.TotalFantasyPointsDelta = persistResult.TotalFantasyPointsDelta;
            result.Errors.AddRange(persistResult.Errors);

            return result;
        }

        // =================================================================
        // Core persist logic (shared by both paths)
        // =================================================================

        private async Task<PersistFinalGamesResult> PersistSnapshotsAsync(
            List<LiveGameSnapshot> snapshots,
            CancellationToken ct)
        {
            var result = new PersistFinalGamesResult
            {
                Date = snapshots.Count > 0
                    ? snapshots[0].GameDate
                    : DateOnly.FromDateTime(DateTime.UtcNow),
            };

            if (snapshots.Count == 0)
            {
                return result;
            }

            // ----- Season ----------------------------------------------
            var seasonCode = snapshots[0].Season;

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    s => s.NhlSeasonCode == seasonCode, ct);

            if (season == null)
            {
                result.Errors.Add(
                    $"Season {seasonCode} not in database. " +
                    "Run League setup.");
                return result;
            }

            var seasonId = season.Id;

            // ----- NHL player IDs across every boxscore ---------------
            var nhlPlayerIds = new HashSet<int>();

            foreach (var s in snapshots)
            {
                if (s.Boxscore == null) continue;

                CollectNhlPlayerIds(
                    s.Boxscore.PlayerByGameStats.AwayTeam, nhlPlayerIds);
                CollectNhlPlayerIds(
                    s.Boxscore.PlayerByGameStats.HomeTeam, nhlPlayerIds);
            }

            if (nhlPlayerIds.Count == 0)
            {
                return result;
            }

            // ----- Bulk read 1: Players -------------------------------
            var playersByNhlId = await _dbContext.Players
                .AsNoTracking()
                .Where(p => nhlPlayerIds.Contains(p.NhlPlayerId))
                .Select(p => new PlayerLookup
                {
                    Id = p.Id,
                    NhlPlayerId = p.NhlPlayerId,
                })
                .ToDictionaryAsync(p => p.NhlPlayerId, ct);

            if (playersByNhlId.Count == 0)
            {
                return result;
            }

            var dbPlayerIds = playersByNhlId.Values
                .Select(p => p.Id)
                .ToList();

            // ----- Bulk read 2: NHL teams (abbrev -> NhlTeamId) -------
            var teamsByAbbrev = await _dbContext.NhlTeams
                .AsNoTracking()
                .ToDictionaryAsync(
                    t => t.Abbreviation,
                    StringComparer.OrdinalIgnoreCase,
                    ct);

            // ----- Bulk read 3: existing PlayerGameLogs ---------------
            var gameIds = snapshots.Select(s => s.GameId).ToList();

            var existingLogs = await _dbContext.PlayerGameLogs
                .Where(g =>
                    gameIds.Contains(g.NhlGameId) &&
                    dbPlayerIds.Contains(g.PlayerId))
                .ToListAsync(ct);

            var logsByKey = existingLogs
                .ToDictionary(g => (g.NhlGameId, g.PlayerId));

            // ----- Bulk read 4: RosterStatusHistory for the season ---
            var historyRows = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h =>
                    h.SeasonId == seasonId &&
                    dbPlayerIds.Contains(h.PlayerId))
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

            // ----- Bulk read 5: FantasyTeamSeasons --------------------
            var teamSeasons = await _dbContext.FantasyTeamSeasons
                .Where(fts => fts.SeasonId == seasonId)
                .ToListAsync(ct);

            var teamSeasonByTeamId = teamSeasons
                .ToDictionary(fts => fts.FantasyTeamId);

            // ----- Bulk read 6: PlayerSeasonStats ---------------------
            var playerSeasonStats = await _dbContext.PlayerSeasonStats
                .Where(s =>
                    s.SeasonId == seasonId &&
                    dbPlayerIds.Contains(s.PlayerId))
                .ToListAsync(ct);

            var seasonStatByPlayerId = playerSeasonStats
                .ToDictionary(s => s.PlayerId);

            // ----- In-memory delta computation -------------------------
            var teamDeltaByTeamId = new Dictionary<int, int>();
            var newLogsToInsert = new List<PlayerGameLog>();

            foreach (var snapshot in snapshots)
            {
                var box = snapshot.Boxscore;
                if (box == null) continue;

                var gameDate = snapshot.GameDate;
                var gameIsFinal = FinishedStates.Contains(snapshot.GameState);

                if (!teamsByAbbrev.TryGetValue(
                        snapshot.AwayAbbreviation, out var awayTeam) ||
                    !teamsByAbbrev.TryGetValue(
                        snapshot.HomeAbbreviation, out var homeTeam))
                {
                    result.Errors.Add(
                        $"Game {snapshot.GameId}: NHL team abbreviation " +
                        "not found in the database.");
                    continue;
                }

                ProcessTeamStats(
                    box,
                    box.PlayerByGameStats.AwayTeam,
                    nhlTeamId: awayTeam.NhlTeamId,
                    opponentNhlTeamId: homeTeam.NhlTeamId,
                    isHomeGame: false,
                    gameDate: gameDate,
                    seasonId: seasonId,
                    gameIsFinal: gameIsFinal,
                    playersByNhlId: playersByNhlId,
                    logsByKey: logsByKey,
                    newLogsToInsert: newLogsToInsert,
                    historyByPlayerId: historyByPlayerId,
                    seasonStatByPlayerId: seasonStatByPlayerId,
                    teamDeltaByTeamId: teamDeltaByTeamId,
                    result: result);

                ProcessTeamStats(
                    box,
                    box.PlayerByGameStats.HomeTeam,
                    nhlTeamId: homeTeam.NhlTeamId,
                    opponentNhlTeamId: awayTeam.NhlTeamId,
                    isHomeGame: true,
                    gameDate: gameDate,
                    seasonId: seasonId,
                    gameIsFinal: gameIsFinal,
                    playersByNhlId: playersByNhlId,
                    logsByKey: logsByKey,
                    newLogsToInsert: newLogsToInsert,
                    historyByPlayerId: historyByPlayerId,
                    seasonStatByPlayerId: seasonStatByPlayerId,
                    teamDeltaByTeamId: teamDeltaByTeamId,
                    result: result);
            }

            // ----- Insert new PlayerGameLog rows -----------------------
            if (newLogsToInsert.Count > 0)
            {
                _dbContext.PlayerGameLogs.AddRange(newLogsToInsert);
                result.GameLogsInserted = newLogsToInsert.Count;
            }

            // ----- Apply team deltas -----------------------------------
            foreach (var kvp in teamDeltaByTeamId)
            {
                if (teamSeasonByTeamId.TryGetValue(kvp.Key, out var ts))
                {
                    ts.TotalFantasyPoints += kvp.Value;
                    ts.TotalFantasyPointsComputedAt = DateTime.UtcNow;
                    result.TeamSeasonsUpdated++;
                    result.TotalFantasyPointsDelta += kvp.Value;
                }
            }

            // ----- Register brand-new PlayerSeasonStat rows ------------
            foreach (var stat in seasonStatByPlayerId.Values)
            {
                if (stat.Id == 0)
                {
                    _dbContext.PlayerSeasonStats.Add(stat);
                    result.SeasonStatsInserted++;
                }
            }

            // ----- Single write ----------------------------------------
            await _dbContext.SaveChangesAsync(ct);

            return result;
        }

        // =================================================================
        // Processing helpers
        // =================================================================

        private static void ProcessTeamStats(
            NhlBoxscoreResponse box,
            NhlTeamPlayerStats teamStats,
            int nhlTeamId,
            int opponentNhlTeamId,
            bool isHomeGame,
            DateOnly gameDate,
            int seasonId,
            bool gameIsFinal,
            Dictionary<int, PlayerLookup> playersByNhlId,
            Dictionary<(long, int), PlayerGameLog> logsByKey,
            List<PlayerGameLog> newLogsToInsert,
            Dictionary<int, List<RosterStatusHistory>> historyByPlayerId,
            Dictionary<int, PlayerSeasonStat> seasonStatByPlayerId,
            Dictionary<int, int> teamDeltaByTeamId,
            PersistFinalGamesResult result)
        {
            foreach (var skater in teamStats.Forwards)
            {
                ProcessSkater(
                    box, skater,
                    nhlTeamId, opponentNhlTeamId, isHomeGame,
                    gameDate, seasonId, gameIsFinal,
                    playersByNhlId, logsByKey, newLogsToInsert,
                    historyByPlayerId, seasonStatByPlayerId,
                    teamDeltaByTeamId, result);
            }

            foreach (var skater in teamStats.Defense)
            {
                ProcessSkater(
                    box, skater,
                    nhlTeamId, opponentNhlTeamId, isHomeGame,
                    gameDate, seasonId, gameIsFinal,
                    playersByNhlId, logsByKey, newLogsToInsert,
                    historyByPlayerId, seasonStatByPlayerId,
                    teamDeltaByTeamId, result);
            }

            foreach (var goalie in teamStats.Goalies)
            {
                var played =
                    goalie.Decision != null ||
                    goalie.ShotsAgainst > 0 ||
                    goalie.Saves > 0 ||
                    goalie.GoalsAgainst > 0;

                if (!played) continue;

                ProcessGoalie(
                    box, goalie,
                    nhlTeamId, opponentNhlTeamId, isHomeGame,
                    gameDate, seasonId, gameIsFinal,
                    playersByNhlId, logsByKey, newLogsToInsert,
                    historyByPlayerId, seasonStatByPlayerId,
                    teamDeltaByTeamId, result);
            }
        }

        private static void ProcessSkater(
            NhlBoxscoreResponse box,
            NhlSkaterStats stats,
            int nhlTeamId,
            int opponentNhlTeamId,
            bool isHomeGame,
            DateOnly gameDate,
            int seasonId,
            bool gameIsFinal,
            Dictionary<int, PlayerLookup> playersByNhlId,
            Dictionary<(long, int), PlayerGameLog> logsByKey,
            List<PlayerGameLog> newLogsToInsert,
            Dictionary<int, List<RosterStatusHistory>> historyByPlayerId,
            Dictionary<int, PlayerSeasonStat> seasonStatByPlayerId,
            Dictionary<int, int> teamDeltaByTeamId,
            PersistFinalGamesResult result)
        {
            // Skater stats are "final once accrued", so gameIsFinal
            // is not used here. The hat-trick bonus applies the moment
            // the third goal goes in.
            _ = gameIsFinal;

            if (!playersByNhlId.TryGetValue(stats.PlayerId, out var player))
            {
                return;
            }

            var hatTrick = stats.Goals >= 3;

            var newFP = stats.Points + (hatTrick ? 3 : 0);

            var key = (box.Id, player.Id);

            if (logsByKey.TryGetValue(key, out var existing))
            {
                var deltaFP = newFP - existing.FantasyPoints;

                var deltaG = stats.Goals - existing.Goals;
                var deltaA = stats.Assists - existing.Assists;
                var deltaP = stats.Points - existing.Points;
                var deltaPM = stats.PlusMinus - existing.PlusMinus;
                var deltaPIM = stats.PenaltyMinutes - existing.PenaltyMinutes;
                var deltaSOG = stats.Shots - existing.Shots;
                var deltaHT =
                    (hatTrick ? 1 : 0) - (existing.HatTrick ? 1 : 0);

                if (deltaFP == 0 &&
                    deltaG == 0 && deltaA == 0 && deltaP == 0 &&
                    deltaPM == 0 && deltaPIM == 0 &&
                    deltaSOG == 0 && deltaHT == 0)
                {
                    return;
                }

                existing.Goals = stats.Goals;
                existing.Assists = stats.Assists;
                existing.Points = stats.Points;
                existing.PenaltyMinutes = stats.PenaltyMinutes;
                existing.PlusMinus = stats.PlusMinus;
                existing.Shots = stats.Shots;
                existing.HatTrick = hatTrick;
                existing.FantasyPoints = newFP;

                ApplyStatDeltas(
                    player.Id,
                    gamesPlayed: 0,
                    goals: deltaG, assists: deltaA, points: deltaP,
                    plusMinus: deltaPM, penaltyMinutes: deltaPIM,
                    shots: deltaSOG, hatTricks: deltaHT,
                    wins: 0, losses: 0, overtimeLosses: 0, shutouts: 0,
                    saves: 0, shotsAgainst: 0, goalsAgainst: 0,
                    seasonId: seasonId,
                    seasonStatByPlayerId: seasonStatByPlayerId);

                CreditTeam(
                    player.Id, deltaFP, gameDate,
                    historyByPlayerId, teamDeltaByTeamId);

                result.GameLogsUpdated++;
            }
            else
            {
                var log = new PlayerGameLog
                {
                    PlayerId = player.Id,
                    SeasonId = seasonId,
                    NhlGameId = box.Id,
                    GameDate = gameDate,
                    NhlTeamId = nhlTeamId,
                    OpponentNhlTeamId = opponentNhlTeamId,
                    IsHomeGame = isHomeGame,
                    Goals = stats.Goals,
                    Assists = stats.Assists,
                    Points = stats.Points,
                    PenaltyMinutes = stats.PenaltyMinutes,
                    PlusMinus = stats.PlusMinus,
                    Shots = stats.Shots,
                    HatTrick = hatTrick,
                    FantasyPoints = newFP,
                };

                newLogsToInsert.Add(log);
                logsByKey[key] = log;

                ApplyStatDeltas(
                    player.Id,
                    gamesPlayed: 1,
                    goals: stats.Goals, assists: stats.Assists,
                    points: stats.Points, plusMinus: stats.PlusMinus,
                    penaltyMinutes: stats.PenaltyMinutes,
                    shots: stats.Shots,
                    hatTricks: hatTrick ? 1 : 0,
                    wins: 0, losses: 0, overtimeLosses: 0, shutouts: 0,
                    saves: 0, shotsAgainst: 0, goalsAgainst: 0,
                    seasonId: seasonId,
                    seasonStatByPlayerId: seasonStatByPlayerId);

                CreditTeam(
                    player.Id, newFP, gameDate,
                    historyByPlayerId, teamDeltaByTeamId);
            }
        }

        private static void ProcessGoalie(
            NhlBoxscoreResponse box,
            NhlGoalieStats stats,
            int nhlTeamId,
            int opponentNhlTeamId,
            bool isHomeGame,
            DateOnly gameDate,
            int seasonId,
            bool gameIsFinal,
            Dictionary<int, PlayerLookup> playersByNhlId,
            Dictionary<(long, int), PlayerGameLog> logsByKey,
            List<PlayerGameLog> newLogsToInsert,
            Dictionary<int, List<RosterStatusHistory>> historyByPlayerId,
            Dictionary<int, PlayerSeasonStat> seasonStatByPlayerId,
            Dictionary<int, int> teamDeltaByTeamId,
            PersistFinalGamesResult result)
        {
            if (!playersByNhlId.TryGetValue(stats.PlayerId, out var player))
            {
                return;
            }

            // Decision stats (W / L / OTL / SO) are NOT final until
            // the horn. During a live game we defer them: only GA,
            // SA and Saves are written. The delta approach handles
            // the transition automatically when the game ends.
            var isWin = gameIsFinal && string.Equals(
                stats.Decision, "W", StringComparison.OrdinalIgnoreCase);

            var isOTLoss = gameIsFinal && string.Equals(
                stats.Decision, "O", StringComparison.OrdinalIgnoreCase);

            var isLoss = gameIsFinal && !isWin && !isOTLoss;

            var isShutout = gameIsFinal && stats.Shutouts > 0;

            var points = stats.Goals + stats.Assists;

            var newFP = points;
            if (isWin) newFP += 2;
            if (isOTLoss) newFP += 1;
            if (isShutout) newFP += 3;

            var key = (box.Id, player.Id);

            if (logsByKey.TryGetValue(key, out var existing))
            {
                var deltaFP = newFP - existing.FantasyPoints;

                var deltaW = (isWin ? 1 : 0) - (existing.GoalieWin ? 1 : 0);
                var deltaOTL =
                    (isOTLoss ? 1 : 0) -
                    (existing.GoalieOvertimeLoss ? 1 : 0);
                var deltaSO = (isShutout ? 1 : 0) - (existing.Shutout ? 1 : 0);
                var deltaGA = stats.GoalsAgainst - existing.GoalsAgainst;
                var deltaSA = stats.ShotsAgainst - existing.ShotsAgainst;
                var deltaSV = stats.Saves - existing.Saves;

                if (deltaFP == 0 && deltaW == 0 && deltaOTL == 0 &&
                    deltaSO == 0 && deltaGA == 0 && deltaSA == 0 &&
                    deltaSV == 0)
                {
                    return;
                }

                existing.GoalsAgainst = stats.GoalsAgainst;
                existing.ShotsAgainst = stats.ShotsAgainst;
                existing.Saves = stats.Saves;
                existing.Shutout = isShutout;
                existing.GoalieWin = isWin;
                existing.GoalieOvertimeLoss = isOTLoss;
                existing.SavePercentage = stats.SavePercentage;
                existing.FantasyPoints = newFP;

                ApplyStatDeltas(
                    player.Id,
                    gamesPlayed: 0,
                    goals: 0, assists: 0, points: 0,
                    plusMinus: 0, penaltyMinutes: 0, shots: 0,
                    hatTricks: 0,
                    wins: deltaW,
                    losses: isLoss ? 1 : 0,
                    overtimeLosses: deltaOTL,
                    shutouts: deltaSO,
                    saves: deltaSV,
                    shotsAgainst: deltaSA,
                    goalsAgainst: deltaGA,
                    seasonId: seasonId,
                    seasonStatByPlayerId: seasonStatByPlayerId);

                CreditTeam(
                    player.Id, deltaFP, gameDate,
                    historyByPlayerId, teamDeltaByTeamId);

                result.GameLogsUpdated++;
            }
            else
            {
                var log = new PlayerGameLog
                {
                    PlayerId = player.Id,
                    SeasonId = seasonId,
                    NhlGameId = box.Id,
                    GameDate = gameDate,
                    NhlTeamId = nhlTeamId,
                    OpponentNhlTeamId = opponentNhlTeamId,
                    IsHomeGame = isHomeGame,
                    Points = points,
                    GoalsAgainst = stats.GoalsAgainst,
                    ShotsAgainst = stats.ShotsAgainst,
                    Saves = stats.Saves,
                    Shutout = isShutout,
                    GoalieWin = isWin,
                    GoalieOvertimeLoss = isOTLoss,
                    SavePercentage = stats.SavePercentage,
                    FantasyPoints = newFP,
                };

                newLogsToInsert.Add(log);
                logsByKey[key] = log;

                ApplyStatDeltas(
                    player.Id,
                    gamesPlayed: 1,
                    goals: 0, assists: 0, points: points,
                    plusMinus: 0, penaltyMinutes: 0, shots: 0,
                    hatTricks: 0,
                    wins: isWin ? 1 : 0,
                    losses: isLoss ? 1 : 0,
                    overtimeLosses: isOTLoss ? 1 : 0,
                    shutouts: isShutout ? 1 : 0,
                    saves: stats.Saves,
                    shotsAgainst: stats.ShotsAgainst,
                    goalsAgainst: stats.GoalsAgainst,
                    seasonId: seasonId,
                    seasonStatByPlayerId: seasonStatByPlayerId);

                CreditTeam(
                    player.Id, newFP, gameDate,
                    historyByPlayerId, teamDeltaByTeamId);
            }
        }

        private static void ApplyStatDeltas(
            int playerId,
            int gamesPlayed,
            int goals, int assists, int points,
            int plusMinus, int penaltyMinutes, int shots, int hatTricks,
            int wins, int losses, int overtimeLosses, int shutouts,
            int saves, int shotsAgainst, int goalsAgainst,
            int seasonId,
            Dictionary<int, PlayerSeasonStat> seasonStatByPlayerId)
        {
            var fpDelta =
                points +
                (hatTricks * 3) +
                (wins * 2) +
                overtimeLosses +
                (shutouts * 3);

            if (!seasonStatByPlayerId.TryGetValue(playerId, out var stat))
            {
                stat = new PlayerSeasonStat
                {
                    PlayerId = playerId,
                    SeasonId = seasonId,
                    GamesPlayed = gamesPlayed,
                    Goals = goals,
                    Assists = assists,
                    Points = points,
                    PlusMinus = plusMinus,
                    PenaltyMinutes = penaltyMinutes,
                    Shots = shots,
                    HatTricks = hatTricks,
                    Wins = wins,
                    Losses = losses,
                    OvertimeLosses = overtimeLosses,
                    Shutouts = shutouts,
                    Saves = saves,
                    ShotsAgainst = shotsAgainst,
                    GoalsAgainst = goalsAgainst,
                    FantasyPoints = fpDelta,
                };

                seasonStatByPlayerId[playerId] = stat;
                return;
            }

            stat.GamesPlayed += gamesPlayed;
            stat.Goals += goals;
            stat.Assists += assists;
            stat.Points += points;
            stat.PlusMinus += plusMinus;
            stat.PenaltyMinutes += penaltyMinutes;
            stat.Shots += shots;
            stat.HatTricks += hatTricks;
            stat.Wins += wins;
            stat.Losses += losses;
            stat.OvertimeLosses += overtimeLosses;
            stat.Shutouts += shutouts;
            stat.Saves += saves;
            stat.ShotsAgainst += shotsAgainst;
            stat.GoalsAgainst += goalsAgainst;
            stat.FantasyPoints += fpDelta;
        }

        private static void CreditTeam(
            int playerId,
            int deltaFP,
            DateOnly gameDate,
            Dictionary<int, List<RosterStatusHistory>> historyByPlayerId,
            Dictionary<int, int> teamDeltaByTeamId)
        {
            if (deltaFP == 0) return;

            if (!historyByPlayerId.TryGetValue(playerId, out var history) ||
                history.Count == 0)
            {
                return;
            }

            var dayStartUtc = new DateTime(
                gameDate.Year, gameDate.Month, gameDate.Day,
                0, 0, 0, DateTimeKind.Utc);

            RosterStatusHistory? effective = null;

            foreach (var row in history)
            {
                if (row.EffectiveAt <= dayStartUtc)
                {
                    effective = row;
                }
                else
                {
                    break;
                }
            }

            if (effective == null ||
                effective.RosterStatus != RosterStatus.Active)
            {
                return;
            }

            teamDeltaByTeamId[effective.FantasyTeamId] =
                teamDeltaByTeamId.GetValueOrDefault(effective.FantasyTeamId) +
                deltaFP;
        }

        private static void CollectNhlPlayerIds(
            NhlTeamPlayerStats team,
            HashSet<int> target)
        {
            foreach (var f in team.Forwards) target.Add(f.PlayerId);
            foreach (var d in team.Defense) target.Add(d.PlayerId);
            foreach (var g in team.Goalies) target.Add(g.PlayerId);
        }

        private sealed class PlayerLookup
        {
            public int Id { get; set; }
            public int NhlPlayerId { get; set; }
        }
    }

    // =====================================================================
    // Result types
    // =====================================================================

    public class RefreshLiveCacheResult
    {
        public int TotalGamesOnSchedule { get; set; }
        public int BoxscoresFetched { get; set; }
        public int SnapshotCount { get; set; }

        // Live persist results (only populated on ticks that persist).
        public int GamesPersisted { get; set; }
        public int PlayersUpdated { get; set; }
        public int TeamDelta { get; set; }

        public List<string> Errors { get; set; } = new();
    }

    public class PersistFinalGamesResult
    {
        public DateOnly Date { get; set; }
        public int FinalGamesOnSchedule { get; set; }
        public int GameLogsInserted { get; set; }
        public int GameLogsUpdated { get; set; }
        public int SeasonStatsInserted { get; set; }
        public int TeamSeasonsUpdated { get; set; }
        public int TotalFantasyPointsDelta { get; set; }
        public List<string> Errors { get; set; } = new();
    }
}