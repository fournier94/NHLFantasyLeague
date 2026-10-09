using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.Logging;

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

        // A fixed "hours since start" grace window was removed: it
        // cut off ended games too early for the user-facing Game Day
        // page, which needs the boxscore of any game played today.
        // The equivalent protection against polling yesterday's
        // games now lives inside ShouldAttachBoxscore as an ET-day
        // comparison.

        // Tracks the last time we fetched each game's boxscore, so the
        // FINAL/OFF polling can back off over time without hitting the
        // API on every tick. Keyed by NHL game id. Pruned every refresh
        // so it does not grow across the season.
        private static readonly System.Collections.Concurrent.ConcurrentDictionary<long, DateTime>
            _lastBoxscoreFetchUtc = new();

        /// <summary>
        /// How long an entry in _lastBoxscoreFetchUtc stays before it
        /// is eligible for pruning. One week is well past the point
        /// where any game can be re-fetched, so pruning has no effect
        /// on the live or final-game polling logic.
        /// </summary>
        private static readonly TimeSpan BoxscoreCacheRetention =
            TimeSpan.FromDays(7);

        /// <summary>
        /// Defensive cap on how long a game is allowed to stay in a
        /// LIVE or CRIT state before we stop polling it.
        ///
        /// Real NHL games never come close to this. It exists only so
        /// a stuck or suspended game cannot poll forever and burn our
        /// share of the NHL API budget. Eight hours is well past the
        /// longest plausible game including pre-game delays.
        /// </summary>
        private static readonly TimeSpan MaxLiveDurationSinceStart =
            TimeSpan.FromHours(8);

        /// <summary>
        /// Grace window after a game's scheduled start during which a
        /// FINAL/OFF game is still polled even if its ET calendar
        /// date is no longer today.
        ///
        /// This is the fix for the LIVE -> FINAL transition that
        /// crosses ET midnight. A West Coast game that starts Oct 1
        /// at 22:00 ET and goes FINAL at 00:30 ET on Oct 2 would
        /// otherwise be excluded by the same-ET-day check the moment
        /// the date rolled over, leaving the live cache frozen on the
        /// last pre-midnight LIVE snapshot and the user-visible clock
        /// stuck on the Game Day page. With this window, the tick
        /// keeps polling the game until it has fetched the real FINAL
        /// boxscore, then it drops out naturally.
        ///
        /// Twelve hours covers any real game plus a generous buffer
        /// for the NHL's post-game corrections. Once the window
        /// expires, the same-day check (or the absence of the game
        /// from the schedule) takes over.
        /// </summary>
        private static readonly TimeSpan RecentFinishedGameGraceWindow =
            TimeSpan.FromHours(12);

        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        /// <summary>
        /// Records unsettled-game warnings into SystemEventLogs so the
        /// admin page can surface "the post-game write for date X ran
        /// while game Y was still LIVE" without anyone having to read
        /// server logs. Every call site wraps the usage in a
        /// try/catch so a logging failure can never break the persist
        /// path.
        /// </summary>
        private readonly SystemEventLogService _log;

        public NhlGameService(
            HttpClient httpClient,
            AppDbContext dbContext,
            SystemEventLogService log)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _log = log;
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

            // Return the whole game week. The NHL returns a week-long
            // schedule here (typically Saturday to Friday), and we
            // intentionally do NOT filter by date on the server:
            // gameDate is unreliable for a handful of games and the
            // user's local clock is what "today" means to them. The
            // GameDayPage filters this list against the user's local
            // calendar day.
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

                // Preserve any boxscore we already fetched for this
                // game in a previous tick. Without this, a game whose
                // ShouldAttachBoxscore answer flips to false (ET day
                // rollover, or a schedule entry that briefly falls
                // outside the poll window) would lose its cached
                // boxscore and become non-clickable on Game Day, even
                // though we fetched it earlier.
                //
                // The cache is not yet replaced at this point in the
                // method, so cache.Get returns the previous tick's
                // snapshot.
                var cached = cache.Get(game.Id);

                if (cached?.Boxscore != null)
                {
                    snapshot.Boxscore = cached.Boxscore;
                }

                // State-transition override.
                //
                // ShouldAttachBoxscore answers "is it worth polling
                // this game on this tick?" using time-based rules.
                // Those rules have a blind spot: a game that goes
                // FINAL after the live window has closed (or after
                // the ET calendar day rolled over, or after the
                // 12-hour grace window) can end up preserved in the
                // cache with a stale LIVE boxscore, and
                // ShouldAttachBoxscore will keep returning false
                // forever.
                //
                // The fix: whenever the schedule says the game has
                // moved to FINAL/OFF but the cache still says
                // LIVE/CRIT, force a fetch regardless of any
                // time-based rule. The transition itself is the
                // trigger.
                //
                // This covers three cases:
                //   - a game that ends while the live window is
                //     closed (between 02:00 and 11:00 ET),
                //   - a game that ends after the ET calendar day
                //     has rolled over,
                //   - a game that ends after the 12-hour grace
                //     window has elapsed.
                var cachedState = cached?.Boxscore?.GameState;

                var scheduleSaysFinished =
                    FinishedStates.Contains(game.GameState);

                var cacheSaysActive =
                    cachedState != null &&
                    (string.Equals(
                        cachedState,
                        "LIVE",
                        StringComparison.OrdinalIgnoreCase) ||
                     string.Equals(
                        cachedState,
                        "CRIT",
                        StringComparison.OrdinalIgnoreCase));

                var forceTransitionFetch =
                    scheduleSaysFinished && cacheSaysActive;

                if (forceTransitionFetch || ShouldAttachBoxscore(game, now))
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

                    // 500 ms between NHL API calls keeps us at the
                    // safe rate of one request every half-second.
                    // The old 200 ms delay produced a 5 req/sec
                    // burst when several games were polled in the
                    // same tick, which occasionally tripped the NHL
                    // rate limit. The tick cadence is 60 s, so the
                    // added wait has no effect on perceived latency.
                    await Task.Delay(500, ct);
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

            PruneBoxscoreCache(now);

            return result;
        }

        private static LiveGameSnapshot BuildSnapshot(NhlScheduleGame game)
        {
            // The NHL /schedule/now endpoint does not reliably populate
            // its gameDate field. When it is missing, System.Text.Json
            // leaves DateOnly at its default (0001-01-01), which
            // Postgres stores as -infinity and which no date-filtered
            // query will ever match.
            //
            // Derive the ET calendar date from StartTimeUtc instead:
            // StartTimeUtc is always populated, and the ET calendar
            // date is the same date the NHL labels the game with
            // (arena-local = ET for every NHL club).
            var gameDate = DateOnly.FromDateTime(
                TimeZoneHelper.ToEastern(game.StartTimeUtc));

            return new LiveGameSnapshot
            {
                GameId = game.Id,
                GameDate = gameDate,
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

        /// <summary>
        /// Removes entries older than <see cref="BoxscoreCacheRetention"/>
        /// from the boxscore cache. Called at the end of every live
        /// refresh. The dictionary is tiny (one entry per game) but
        /// pruning keeps it from growing unbounded across a season.
        /// </summary>
        private static void PruneBoxscoreCache(DateTime now)
        {
            var cutoff = now - BoxscoreCacheRetention;

            foreach (var kvp in _lastBoxscoreFetchUtc)
            {
                if (kvp.Value < cutoff)
                {
                    _lastBoxscoreFetchUtc.TryRemove(kvp.Key, out _);
                }
            }
        }

        /// <summary>
        /// Decides whether to fetch a fresh boxscore for one game on
        /// the current tick.
        ///
        /// There are two independent questions this function answers:
        ///
        ///   1. Is this game still producing data? (LIVE / CRIT)
        ///      Live games must always be polled, regardless of
        ///      which ET calendar day they started on. This is what
        ///      stops a West Coast game that started at 22:30 ET
        ///      from falling out of the poll set at 00:00 ET.
        ///
        ///   2. Is this game finished, and recent enough to still be
        ///      worth re-fetching? (FINAL / OFF)
        ///      A finished game is polled if either its ET calendar
        ///      date is today, or it started within the grace window.
        ///      The grace window is what keeps polling a game that
        ///      went FINAL just after ET midnight, so its real final
        ///      boxscore lands in the cache before the game drops
        ///      out of the schedule.
        ///
        /// Defensive cap: a game stuck in a LIVE state for more than
        /// MaxLiveDurationSinceStart is treated as if it were done.
        /// This exists only so a suspended or otherwise stuck game
        /// cannot poll forever.
        ///
        /// The ET-day comparison uses TimeZoneHelper.GetNhlGameDateEt,
        /// the same computation the rest of the pipeline uses for
        /// PlayerGameLog.GameDate, so the polling decision stays
        /// consistent with the game's assigned date.
        /// </summary>
        private static bool ShouldAttachBoxscore(
            NhlScheduleGame game,
            DateTime now)
        {
            if (!BoxscoreStates.Contains(game.GameState))
            {
                return false;
            }

            var timeSinceStart = now - game.StartTimeUtc;

            var isLive =
                string.Equals(
                    game.GameState,
                    "LIVE",
                    StringComparison.OrdinalIgnoreCase) ||
                string.Equals(
                    game.GameState,
                    "CRIT",
                    StringComparison.OrdinalIgnoreCase);

            if (isLive)
            {
                // Defensive cap: real NHL games never run this long.
                // If the NHL has left a game in a LIVE state past
                // this window, treat it as done so we stop polling.
                if (timeSinceStart > MaxLiveDurationSinceStart)
                {
                    return false;
                }

                _lastBoxscoreFetchUtc[game.Id] = now;
                return true;
            }

            // FINAL / OFF.
            //
            // Two conditions qualify a finished game for polling:
            //
            //   a) Same ET calendar day. The game started today and
            //      finished today, so we keep refreshing it for the
            //      rest of the day.
            //
            //   b) Within the grace window after its scheduled start.
            //      This catches the LIVE -> FINAL transition that
            //      crosses ET midnight. Without it, the tick that
            //      sees FINAL for the first time after midnight
            //      would skip the game, and the cache would hold the
            //      last pre-midnight LIVE snapshot indefinitely.
            var todayEt = TimeZoneHelper.GetNhlGameDateEt(now);
            var gameDateEt = TimeZoneHelper.GetNhlGameDateEt(
                game.StartTimeUtc);

            var sameEtDay = gameDateEt == todayEt;
            var withinGraceWindow =
                timeSinceStart < RecentFinishedGameGraceWindow;

            if (!sameEtDay && !withinGraceWindow)
            {
                return false;
            }

            // Per-game backoff. A game that started recently is
            // polled aggressively (once a minute for the first 3
            // hours); one that started longer ago backs off to
            // once every 5 minutes. This runs the same way whether
            // the game qualified via (a) or (b).
            var minMinutesBetweenFetches =
                timeSinceStart.TotalMinutes < 180 ? 1 : 5;

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
        /// Idempotent: running it twice on the same date does zero
        /// writes the second time.
        ///
        /// CONVERGENCE CONTRACT
        ///
        /// The method reports two separate things to its caller:
        ///
        ///   - The FINAL/OFF games it managed to persist (same
        ///     statistics as before).
        ///   - The set of games on this date that are NOT yet in a
        ///     terminal state (FUT, PRE, LIVE, CRIT), via
        ///     result.UnsettledGameIds.
        ///
        /// The second signal is what lets the post-game write and the
        /// season reconciliation retry themselves until every game on
        /// the date has settled. The most common real-world case is a
        /// West Coast game still in the third period when the 02:30 ET
        /// post-game write fires; without this signal, the job would
        /// mark the date done and never come back for the game that
        /// finished at 03:15 ET.
        ///
        /// A Warning is written to SystemEventLogs whenever unsettled
        /// games are found, so the admin page can show what happened
        /// without needing server-side log access.
        /// </summary>
        public async Task<PersistFinalGamesResult> PersistFinalGamesForDateAsync(
            DateOnly date,
            CancellationToken ct = default)
        {
            var result = new PersistFinalGamesResult { Date = date };

            var schedule = await GetScheduleForDateAsync(date, ct);

            // Unsettled = any game scheduled on this date whose state
            // is not FINAL or OFF. That includes FUT, PRE, LIVE and
            // CRIT — all of them mean "we cannot finalize this date
            // yet." The already-final games on the date are still
            // persisted below; the caller uses UnsettledGameIds to
            // decide whether to retry later.
            var unsettled = schedule
                .Where(g => !FinishedStates.Contains(g.GameState))
                .ToList();

            result.UnsettledGameIds = unsettled
                .Select(g => g.Id)
                .ToList();

            if (unsettled.Count > 0)
            {
                await LogUnsettledGamesAsync(date, unsettled, ct);
            }

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

                // 500 ms between NHL API calls keeps us at the safe
                // rate of one request every half-second. The old
                // 300 ms delay ran at ~3.3 req/sec, which tripped
                // the NHL rate limit (429) during post-game and
                // reconciliation runs.
                await Task.Delay(500, ct);
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

        /// <summary>
        /// Records a Warning in SystemEventLogs listing every game on
        /// the target date that was not in a terminal state when the
        /// persist ran. Never throws: a logging failure must not
        /// cascade into the persist path.
        ///
        /// The message is kept short so it fits the 500-char Message
        /// column; per-game detail (id, state, start time) goes into
        /// Details, which allows up to 2000 chars.
        /// </summary>
        private async Task LogUnsettledGamesAsync(
      DateOnly date,
      List<NhlScheduleGame> unsettled,
      CancellationToken ct)
        {
            try
            {
                var ids = string.Join(
                    ", ",
                    unsettled.Select(g => g.Id));

                var details = string.Join(
                    "\n",
                    unsettled.Select(g =>
                        $"{g.Id} {g.GameState} " +
                        $"starts {g.StartTimeUtc:yyyy-MM-dd HH:mm:ss} UTC"));

                await _log.RecordAsync(
                    source: "NhlGameService",
                    category: "PostGameWriteUnsettled",
                    severity: "Warning",
                    message:
                        $"Post-game write for {date:yyyy-MM-dd} found " +
                        $"{unsettled.Count} unsettled game(s): {ids}.",
                    details: details,
                    ct: ct);
            }
            catch
            {
                // Never let logging failure cascade.
            }
        }

        /// <summary>
        /// Records a Warning in SystemEventLogs when the live persist
        /// produces a team delta whose Forward+Defense+Goalie sum
        /// does not equal the delta's total.
        ///
        /// This should never fire: BuildSkaterDelta and
        /// BuildGoalieDelta route each game's FP into exactly one of
        /// the three buckets. If it does fire, the routing has a bug
        /// that would otherwise silently drift the standings until
        /// the next recompute.
        ///
        /// Never throws: a logging failure must not break the persist
        /// path.
        /// </summary>
        private async Task LogPersistInvariantViolationsAsync(
            List<string> violations,
            CancellationToken ct)
        {
            try
            {
                var details = string.Join("\n", violations);

                await _log.RecordAsync(
                    source: "NhlGameService",
                    category: "TeamTotalInvariantViolation",
                    severity: "Warning",
                    message:
                        $"Live persist produced {violations.Count} " +
                        "team delta(s) whose Forward+Defense+Goalie " +
                        "sum did not match the total.",
                    details: details,
                    ct: ct);
            }
            catch
            {
                // Never let logging failure cascade.
            }
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
            //
            // Position is loaded here so the routing step can bucket
            // each game's fantasy points by the player's position
            // group without any further DB query. Same source as the
            // season recompute (Players.Position), so both writers
            // route every game identically.
            var playersByNhlId = await _dbContext.Players
                .AsNoTracking()
                .Where(p => nhlPlayerIds.Contains(p.NhlPlayerId))
                .Select(p => new PlayerLookup
                {
                    Id = p.Id,
                    NhlPlayerId = p.NhlPlayerId,
                    Position = p.Position,
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
            //
            // Duplicate-safe: if two rows in NhlTeams ever share an
            // abbreviation (the UTA 59/68 incident from Oct 8 is the
            // canonical example), a plain ToDictionaryAsync throws
            // ArgumentException and kills the whole persist for the
            // tick — every game's stats for every player, not just
            // the affected team's. Grouping first and picking one
            // row per abbreviation makes the persist immune to that
            // class of data anomaly.
            //
            // Preference order within a group:
            //   1. IsActive = true (the current row).
            //   2. Lowest NhlTeamId, as a deterministic tiebreak.
            //
            // An inactive duplicate would only be picked if no active
            // row exists for that abbreviation, which is itself a
            // data-integrity problem worth logging, but is not a
            // reason to fail the entire persist.
            var teamRows = await _dbContext.NhlTeams
                .AsNoTracking()
                .ToListAsync(ct);

            var teamsByAbbrev = teamRows
                .GroupBy(
                    t => t.Abbreviation,
                    StringComparer.OrdinalIgnoreCase)
                .ToDictionary(
                    g => g.Key,
                    g => g
                        .OrderByDescending(t => t.IsActive)
                        .ThenBy(t => t.NhlTeamId)
                        .First(),
                    StringComparer.OrdinalIgnoreCase);

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

            // PlayerCareerStat is intentionally NOT loaded or written
            // here. It is the historical archive owned by the landing
            // sync (SyncCareerStatsFromLandingAsync). Writing live
            // deltas to it created a dual-writer race with the
            // landing page, which lags the boxscore by up to a day.
            // All current-season live data lives in PlayerSeasonStat,
            // which is derived from PlayerGameLog.

            // ----- In-memory delta computation -------------------------
            var teamDeltaByTeamId = new Dictionary<int, TeamStatDelta>();
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
            //
            // Each team's accumulated delta carries the total FP and
            // the three position-split FP values. The three splits
            // must sum to the total for every delta; if they don't,
            // a routing bug exists in BuildSkaterDelta or
            // BuildGoalieDelta and the standings would silently
            // disagree with themselves. The check below catches that
            // on the same tick it happens.
            var invariantViolations = new List<string>();

            foreach (var kvp in teamDeltaByTeamId)
            {
                if (!teamSeasonByTeamId.TryGetValue(kvp.Key, out var ts))
                {
                    continue;
                }

                var d = kvp.Value;

                ts.TotalFantasyPoints += d.FantasyPoints;

                // Position-split fantasy points. Each game is routed
                // to exactly one of the three buckets by the delta
                // builders, so a game's FP is never counted twice and
                // never dropped.
                ts.ForwardFantasyPoints += d.ForwardFantasyPoints;
                ts.DefenseFantasyPoints += d.DefenseFantasyPoints;
                ts.GoalieFantasyPoints += d.GoalieFantasyPoints;

                ts.SkaterGamesPlayed += d.SkaterGamesPlayed;
                ts.SkaterGoals += d.SkaterGoals;
                ts.SkaterAssists += d.SkaterAssists;
                ts.SkaterPoints += d.SkaterPoints;
                ts.SkaterHatTricks += d.SkaterHatTricks;

                ts.GoalieGamesPlayed += d.GoalieGamesPlayed;
                ts.GoalieWins += d.GoalieWins;
                ts.GoalieLosses += d.GoalieLosses;
                ts.GoalieOvertimeLosses += d.GoalieOvertimeLosses;
                ts.GoalieShutouts += d.GoalieShutouts;
                ts.GoaliePoints += d.GoaliePoints;

                ts.TotalFantasyPointsComputedAt = DateTime.UtcNow;
                result.TeamSeasonsUpdated++;
                result.TotalFantasyPointsDelta += d.FantasyPoints;

                // Delta-level invariant check. This is a code-correctness
                // check, not a data-repair: it verifies that the routing
                // in this tick produced a consistent delta. The
                // authoritative check on the actual DB totals lives in
                // NhlGameLogService.RecomputeTeamSeasonTotalsAsync and
                // runs on every recompute.
                var deltaSum =
                    d.ForwardFantasyPoints +
                    d.DefenseFantasyPoints +
                    d.GoalieFantasyPoints;

                if (deltaSum != d.FantasyPoints)
                {
                    invariantViolations.Add(
                        $"FantasyTeamId={kvp.Key}: " +
                        $"deltaTotal={d.FantasyPoints}, " +
                        $"deltaF+D+G={deltaSum} " +
                        $"(F={d.ForwardFantasyPoints}, " +
                        $"D={d.DefenseFantasyPoints}, " +
                        $"G={d.GoalieFantasyPoints})");
                }
            }

            if (invariantViolations.Count > 0)
            {
                await LogPersistInvariantViolationsAsync(
                    invariantViolations,
                    ct);
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
            //
            // FantasyTeamSeason now carries an xmin concurrency token
            // (see AppDbContext). If the season recompute updated one of
            // our rows between our load and our save, SaveChangesAsync
            // throws DbUpdateConcurrencyException instead of silently
            // overwriting the recompute's changes.
            //
            // We do NOT retry here. The exception propagates to the
            // caller, which reruns the whole persist on its next tick
            // with fresh deltas computed from the current DB state:
            //
            //   - Live refresh: caught by RunLiveRefreshAsync; the
            //     next tick fires 60 seconds later.
            //   - Post-game write / reconciliation: caught by their own
            //     try/catch and rescheduled via ScheduleSettleRetry.
            //
            // Retrying inside this method would mean reloading every
            // pending entity (new PlayerGameLog inserts, new
            // PlayerSeasonStat inserts, plus the FantasyTeamSeason
            // updates) which is more fragile than letting the caller
            // redo the work from scratch.
            try
            {
                await _dbContext.SaveChangesAsync(ct);
            }
            catch (DbUpdateConcurrencyException ex)
            {
                await _log.RecordAsync(
                    source: "NhlGameService",
                    category: "ConcurrencyConflict",
                    severity: "Warning",
                    message:
                        "FantasyTeamSeason concurrency conflict during " +
                        "persist. The caller will retry on the next tick.",
                    details: ex.Message,
                    ct: ct);

                throw;
            }

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
        Dictionary<int, TeamStatDelta> teamDeltaByTeamId,
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
Dictionary<int, TeamStatDelta> teamDeltaByTeamId,
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

            // Classify the player's position once and reuse it for
            // both the update and the insert branches. Same helper
            // and same source (Players.Position) as the season
            // recompute, so both writers bucket every game
            // identically.
            var positionGroup = PositionGroupHelper.Classify(
                player.Position);

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

                // Time on ice only grows during a game; use MaxToi to
                // guard against a stale re-fetch ever reducing it.
                var newToi = MaxToi(existing.TimeOnIce, stats.TimeOnIce);
                var toiChanged = !string.Equals(
                    newToi,
                    existing.TimeOnIce,
                    StringComparison.Ordinal);

                if (deltaFP == 0 &&
                    deltaG == 0 && deltaA == 0 && deltaP == 0 &&
                    deltaPM == 0 && deltaPIM == 0 &&
                    deltaSOG == 0 && deltaHT == 0 &&
                    !toiChanged)
                {
                    return;
                }

                existing.GameDate = gameDate;
                existing.Goals = stats.Goals;
                existing.Assists = stats.Assists;
                existing.Points = stats.Points;
                existing.PenaltyMinutes = stats.PenaltyMinutes;
                existing.PlusMinus = stats.PlusMinus;
                existing.Shots = stats.Shots;
                existing.TimeOnIce = newToi;
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
                    player.Id,
                    BuildSkaterDelta(
                        fantasyPoints: deltaFP,
                        gamesPlayed: 0,
                        goals: deltaG,
                        assists: deltaA,
                        points: deltaP,
                        hatTricks: deltaHT,
                        positionGroup: positionGroup),
                    gameDate,
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
                    TimeOnIce = stats.TimeOnIce,
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
                    player.Id,
                    BuildSkaterDelta(
                        fantasyPoints: newFP,
                        gamesPlayed: 1,
                        goals: stats.Goals,
                        assists: stats.Assists,
                        points: stats.Points,
                        hatTricks: hatTrick ? 1 : 0,
                        positionGroup: positionGroup),
                    gameDate,
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
Dictionary<int, TeamStatDelta> teamDeltaByTeamId,
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

            var isLoss = gameIsFinal && string.Equals(
                stats.Decision, "L", StringComparison.OrdinalIgnoreCase);

            // The NHL boxscore endpoint does NOT return a per-game
            // "shutouts" field on goalies. stats.Shutouts therefore
            // always stays at 0 through this path, and cannot be used
            // to detect a shutout. Derive it from the real condition
            // instead:
            //
            //   - game is final,
            //   - the goalie allowed no goals,
            //   - he actually faced shots (excludes a 0-second goalie
            //     entry with 0/0),
            //   - he was the goalie of record (a pulled starter with
            //     no decision is not credited with a shutout).
            //
            // This matches the NHL rule: a goalie earns a shutout by
            // playing the whole game (regulation + any OT) and
            // allowing no goals. A shootout loss still counts as a
            // shutout, which is why we do not require a specific
            // decision value.
            var isShutout =
                gameIsFinal &&
                stats.GoalsAgainst == 0 &&
                stats.ShotsAgainst > 0 &&
                stats.Decision != null;

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
                var deltaL = (isLoss ? 1 : 0) - (existing.GoalieLoss ? 1 : 0);
                var deltaOTL =
                    (isOTLoss ? 1 : 0) -
                    (existing.GoalieOvertimeLoss ? 1 : 0);
                var deltaSO = (isShutout ? 1 : 0) - (existing.Shutout ? 1 : 0);
                var deltaGA = stats.GoalsAgainst - existing.GoalsAgainst;
                var deltaSA = stats.ShotsAgainst - existing.ShotsAgainst;
                var deltaSV = stats.Saves - existing.Saves;

                var newToi = MaxToi(existing.TimeOnIce, stats.TimeOnIce);
                var toiChanged = !string.Equals(
                    newToi,
                    existing.TimeOnIce,
                    StringComparison.Ordinal);

                if (deltaFP == 0 && deltaW == 0 && deltaL == 0 &&
                    deltaOTL == 0 && deltaSO == 0 && deltaGA == 0 &&
                    deltaSA == 0 && deltaSV == 0 &&
                    !toiChanged)
                {
                    return;
                }

                // A goalie's own G / A / PTS can change after review
                // (an assist added, a goal awarded), so update those
                // fields on the log row and pass their deltas to
                // ApplyStatDeltas. Without this, the log row and the
                // PlayerSeasonStat row drift on any goalie-point
                // change.
                var newGoals = stats.Goals;
                var newAssists = stats.Assists;
                var newPoints = newGoals + newAssists;

                var deltaG = newGoals - existing.Goals;
                var deltaA = newAssists - existing.Assists;
                var deltaP = newPoints - existing.Points;

                existing.GameDate = gameDate;
                existing.Goals = newGoals;
                existing.Assists = newAssists;
                existing.Points = newPoints;
                existing.GoalsAgainst = stats.GoalsAgainst;
                existing.ShotsAgainst = stats.ShotsAgainst;
                existing.Saves = stats.Saves;
                existing.TimeOnIce = newToi;
                existing.Shutout = isShutout;
                existing.GoalieWin = isWin;
                existing.GoalieLoss = isLoss;
                existing.GoalieOvertimeLoss = isOTLoss;
                existing.SavePercentage = stats.SavePercentage;
                existing.FantasyPoints = newFP;

                ApplyStatDeltas(
                    player.Id,
                    gamesPlayed: 0,
                    goals: deltaG, assists: deltaA, points: deltaP,
                    plusMinus: 0, penaltyMinutes: 0, shots: 0,
                    hatTricks: 0,
                    wins: deltaW,
                    losses: deltaL,
                    overtimeLosses: deltaOTL,
                    shutouts: deltaSO,
                    saves: deltaSV,
                    shotsAgainst: deltaSA,
                    goalsAgainst: deltaGA,
                    seasonId: seasonId,
                    seasonStatByPlayerId: seasonStatByPlayerId);

                CreditTeam(
                    player.Id,
                    BuildGoalieDelta(
                        fantasyPoints: deltaFP,
                        gamesPlayed: 0,
                        wins: deltaW,
                        losses: deltaL,
                        overtimeLosses: deltaOTL,
                        shutouts: deltaSO,
                        points: deltaP),
                    gameDate,
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
                    TimeOnIce = stats.TimeOnIce,
                    Shutout = isShutout,
                    GoalieWin = isWin,
                    GoalieLoss = isLoss,
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
                    player.Id,
                    BuildGoalieDelta(
                        fantasyPoints: newFP,
                        gamesPlayed: 1,
                        wins: isWin ? 1 : 0,
                        losses: isLoss ? 1 : 0,
                        overtimeLosses: isOTLoss ? 1 : 0,
                        shutouts: isShutout ? 1 : 0,
                        points: points),
                    gameDate,
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
       TeamStatDelta delta,
       DateOnly gameDate,
       Dictionary<int, List<RosterStatusHistory>> historyByPlayerId,
       Dictionary<int, TeamStatDelta> teamDeltaByTeamId)
        {
            if (delta.IsEmpty) return;

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

            if (!teamDeltaByTeamId.TryGetValue(
                    effective.FantasyTeamId, out var teamDelta))
            {
                teamDelta = new TeamStatDelta();
                teamDeltaByTeamId[effective.FantasyTeamId] = teamDelta;
            }

            teamDelta.Add(delta);
        }

        private static TeamStatDelta BuildSkaterDelta(
      int fantasyPoints,
      int gamesPlayed,
      int goals,
      int assists,
      int points,
      int hatTricks,
      PositionGroup positionGroup)
        {
            var delta = new TeamStatDelta
            {
                FantasyPoints = fantasyPoints,
                SkaterGamesPlayed = gamesPlayed,
                SkaterGoals = goals,
                SkaterAssists = assists,
                SkaterPoints = points,
                SkaterHatTricks = hatTricks,
            };

            // Route the fantasy points into the forward or defense
            // bucket. Unknown positions go into forward, matching the
            // season recompute and the frontend default
            // (toLineupPositionGroup returns 'F' for unknown). This
            // keeps F + D + G == Total exact.
            if (positionGroup == PositionGroup.Defense)
            {
                delta.DefenseFantasyPoints = fantasyPoints;
            }
            else
            {
                delta.ForwardFantasyPoints = fantasyPoints;
            }

            return delta;
        }

        private static TeamStatDelta BuildGoalieDelta(
            int fantasyPoints,
            int gamesPlayed,
            int wins,
            int losses,
            int overtimeLosses,
            int shutouts,
            int points)
        {
            return new TeamStatDelta
            {
                FantasyPoints = fantasyPoints,

                // A goalie's game always routes to the goalie bucket.
                GoalieFantasyPoints = fantasyPoints,

                GoalieGamesPlayed = gamesPlayed,
                GoalieWins = wins,
                GoalieLosses = losses,
                GoalieOvertimeLosses = overtimeLosses,
                GoalieShutouts = shutouts,
                GoaliePoints = points,
            };
        }

        // ApplyCareerDeltas was removed: PlayerCareerStat is the
        // historical archive owned by the landing sync, and the live
        // refresh no longer writes to it. Current-season per-game
        // stats live in PlayerSeasonStat (derived from PlayerGameLog).

        private static void CollectNhlPlayerIds(
            NhlTeamPlayerStats team,
            HashSet<int> target)
        {
            foreach (var f in team.Forwards) target.Add(f.PlayerId);
            foreach (var d in team.Defense) target.Add(d.PlayerId);
            foreach (var g in team.Goalies) target.Add(g.PlayerId);
        }

        /// <summary>
        /// Parses an "MM:SS" time-on-ice string into total seconds.
        /// Returns -1 when the value is null, empty, or unparsable,
        /// so callers can tell "no value" from "00:00".
        /// </summary>
        private static int ParseToiToSeconds(string? toi)
        {
            if (string.IsNullOrWhiteSpace(toi))
            {
                return -1;
            }

            var parts = toi.Split(':');

            if (parts.Length != 2)
            {
                return -1;
            }

            if (!int.TryParse(parts[0], out var minutes))
            {
                return -1;
            }

            if (!int.TryParse(parts[1], out var seconds))
            {
                return -1;
            }

            return minutes * 60 + seconds;
        }

        /// <summary>
        /// Returns whichever of the two "MM:SS" strings represents
        /// the larger amount of ice time. Used by the update guards
        /// so a stale re-fetch can never decrease a game's recorded
        /// TOI. Nulls and unparsable values are treated as "no value".
        /// </summary>
        private static string? MaxToi(string? current, string? incoming)
        {
            var currentSeconds = ParseToiToSeconds(current);
            var incomingSeconds = ParseToiToSeconds(incoming);

            if (currentSeconds < 0)
            {
                return incoming;
            }

            if (incomingSeconds < 0)
            {
                return current;
            }

            return incomingSeconds > currentSeconds
                ? incoming
                : current;
        }

        private sealed class PlayerLookup
        {
            public int Id { get; set; }
            public int NhlPlayerId { get; set; }

            /// <summary>
            /// The player's position from the Players table. Used to
            /// route the game's fantasy points into the forward,
            /// defense or goalie bucket. Same source as the season
            /// recompute, so both writers always agree.
            /// </summary>
            public string Position { get; set; } = string.Empty;
        }

        /// <summary>
        /// Accumulates per-team stat deltas for one persist tick,
        /// split between the skater and goalie segments so the
        /// FantasyTeamSeason aggregates stay accurate during live
        /// games.
        /// </summary>
        private sealed class TeamStatDelta
        {
            public int FantasyPoints { get; set; }

            // Position-split fantasy points. Every game is routed to
            // exactly one of the three; the sum always equals
            // FantasyPoints. Verified by the delta invariant check in
            // PersistSnapshotsAsync.
            public int ForwardFantasyPoints { get; set; }
            public int DefenseFantasyPoints { get; set; }
            public int GoalieFantasyPoints { get; set; }

            // Skater segment (raw NHL stats, not FP; unchanged)
            public int SkaterGamesPlayed { get; set; }
            public int SkaterGoals { get; set; }
            public int SkaterAssists { get; set; }
            public int SkaterPoints { get; set; }
            public int SkaterHatTricks { get; set; }

            // Goalie segment (raw NHL stats, not FP; unchanged)
            public int GoalieGamesPlayed { get; set; }
            public int GoalieWins { get; set; }
            public int GoalieLosses { get; set; }
            public int GoalieOvertimeLosses { get; set; }
            public int GoalieShutouts { get; set; }
            public int GoaliePoints { get; set; }

            public bool IsEmpty =>
                FantasyPoints == 0 &&
                ForwardFantasyPoints == 0 &&
                DefenseFantasyPoints == 0 &&
                GoalieFantasyPoints == 0 &&
                SkaterGamesPlayed == 0 && SkaterGoals == 0 &&
                SkaterAssists == 0 && SkaterPoints == 0 &&
                SkaterHatTricks == 0 &&
                GoalieGamesPlayed == 0 && GoalieWins == 0 &&
                GoalieLosses == 0 && GoalieOvertimeLosses == 0 &&
                GoalieShutouts == 0 && GoaliePoints == 0;

            public void Add(TeamStatDelta other)
            {
                FantasyPoints += other.FantasyPoints;

                ForwardFantasyPoints += other.ForwardFantasyPoints;
                DefenseFantasyPoints += other.DefenseFantasyPoints;
                GoalieFantasyPoints += other.GoalieFantasyPoints;

                SkaterGamesPlayed += other.SkaterGamesPlayed;
                SkaterGoals += other.SkaterGoals;
                SkaterAssists += other.SkaterAssists;
                SkaterPoints += other.SkaterPoints;
                SkaterHatTricks += other.SkaterHatTricks;

                GoalieGamesPlayed += other.GoalieGamesPlayed;
                GoalieWins += other.GoalieWins;
                GoalieLosses += other.GoalieLosses;
                GoalieOvertimeLosses += other.GoalieOvertimeLosses;
                GoalieShutouts += other.GoalieShutouts;
                GoaliePoints += other.GoaliePoints;
            }
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

    /// <summary>
    /// Outcome of one persist run for a specific ET calendar date.
    ///
    /// Carries two separate signals that callers rely on:
    ///
    ///   - What was actually written (GameLogsInserted, etc.).
    ///   - Whether the date is fully settled (UnsettledGameIds,
    ///     IsSettled). The post-game write and the season
    ///     reconciliation use the latter to decide whether they are
    ///     done for this date or need to retry later.
    /// </summary>
    public class PersistFinalGamesResult
    {
        public DateOnly Date { get; set; }
        public int FinalGamesOnSchedule { get; set; }
        public int GameLogsInserted { get; set; }
        public int GameLogsUpdated { get; set; }
        public int SeasonStatsInserted { get; set; }
        public int TeamSeasonsUpdated { get; set; }
        public int TotalFantasyPointsDelta { get; set; }

        /// <summary>
        /// NHL game IDs for every game on the target date that was
        /// still in a non-terminal state (FUT, PRE, LIVE, CRIT) when
        /// the persist ran.
        ///
        /// An empty list means the date is fully settled: every game
        /// on it is FINAL or OFF and has been written (or was already
        /// up to date). A non-empty list means the caller should
        /// retry later; the post-game write and the season
        /// reconciliation use this signal to keep themselves running
        /// until the date converges.
        /// </summary>
        public List<long> UnsettledGameIds { get; set; } = new();

        /// <summary>
        /// True when every game on the target date is FINAL or OFF.
        /// Convenience for callers that only care about the boolean.
        ///
        /// Deliberately does NOT consider Errors: a fetch failure on a
        /// game that the schedule already reported as FINAL is a
        /// different class of problem, and the caller sees it via the
        /// Errors list. Keeping IsSettled purely about the schedule
        /// lets a caller distinguish "the game hasn't finished" from
        /// "the game finished but we couldn't reach the NHL API."
        /// </summary>
        public bool IsSettled => UnsettledGameIds.Count == 0;

        public List<string> Errors { get; set; } = new();
    }
}