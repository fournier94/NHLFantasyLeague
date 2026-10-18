using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services
{
    /// <summary>
    /// Roster administration: assign, move, release and update players on
    /// fantasy teams, read a team roster with totals, and search players.
    /// Only basic validation is applied (ids must exist, a player can only be
    /// on one fantasy team per season). Roster size limits are NOT enforced.
    /// </summary>
    public class RosterAdminService
    {
        private readonly AppDbContext _dbContext;
        private readonly Services.Jobs.ScheduledJobsRunner _jobs;
        private readonly Services.Cache.ResponseCacheService _cache;

        /// <summary>NHL season code of two seasons ago, used by the player cards.</summary>
        private const int TwoSeasonsAgoNhlCode =
            NhlFantasyLeague.api.Constants.SeasonCodes.TwoSeasonsAgo;

        /// <summary>NHL season code of the previous season, used by the player cards.</summary>
        private const int PreviousSeasonNhlCode =
            NhlFantasyLeague.api.Constants.SeasonCodes.Previous;

        /// <summary>NHL season code of the current season, used by the player cards.</summary>
        private const int CurrentSeasonNhlCode =
            NhlFantasyLeague.api.Constants.SeasonCodes.Current;

        /// <summary>How many seasons the future cap projection covers, starting with the current one.</summary>
        private const int FutureCapSeasonCount = 5;

        public RosterAdminService(
              AppDbContext dbContext,
              Services.Jobs.ScheduledJobsRunner jobs,
              Services.Cache.ResponseCacheService cache)
        {
            _dbContext = dbContext;
            _jobs = jobs;
            _cache = cache;
        }

        public async Task<RosterActionResultDto> AssignPlayerAsync(AssignPlayerRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return Failure("Season not found. Run POST /api/League/setup first.");
            }

            var team = await _dbContext.FantasyTeams
                .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId);

            if (team == null)
            {
                return Failure($"Fantasy team {request.FantasyTeamId} not found.");
            }

            var player = await _dbContext.Players
                .Include(p => p.NhlTeam)
                .FirstOrDefaultAsync(p => p.Id == request.PlayerId);

            if (player == null)
            {
                return Failure(
                    $"Player {request.PlayerId} not found. " +
                    "Use GET /api/Roster/search to find the Player.Id.");
            }

            if (!TryParseRosterStatus(request.RosterStatus, out var rosterStatus))
            {
                return Failure(
                    $"Invalid RosterStatus '{request.RosterStatus}'. " +
                    "Use Active, Bench or Prospect.");
            }

            var existingEntry = await _dbContext.RosterEntries
                .Include(e => e.FantasyTeam)
                .FirstOrDefaultAsync(e =>
                    e.SeasonId == season.Id &&
                    e.PlayerId == player.Id);

            if (existingEntry != null)
            {
                var message = existingEntry.FantasyTeamId == team.Id
                    ? $"'{PlayerName(player)}' is already on '{team.Name}' for {season.Name}."
                    : $"'{PlayerName(player)}' is already on " +
                      $"'{existingEntry.FantasyTeam?.Name}' for {season.Name}. " +
                      "Use POST /api/Roster/move to transfer him.";

                return Failure(message);
            }

            var fantasySalary = await ResolveSalaryFromContractsAsync(
      player.Id,
      season.NhlSeasonCode);

            var entry = new RosterEntry
            {
                PlayerId = player.Id,
                FantasyTeamId = team.Id,
                SeasonId = season.Id,
                RosterStatus = rosterStatus,
                FantasySalary = fantasySalary,
                RosterSlot = request.RosterSlot ?? 0
            };

            entry.Player = player;

            _dbContext.RosterEntries.Add(entry);

            // Append a history row so the scoring recompute knows
            // this player became Active/Bench/Prospect on this team.
            //
            // The effective instant is TOMORROW 00:00 UTC, not today.
            // The recompute credits a game to a team iff the last
            // history row with EffectiveAt <= game-day 00:00 UTC is
            // Active. If we used today 00:00 UTC, a game that already
            // started earlier the same ET day (a matinee) would be
            // retroactively credited to the new team, even though
            // the player was still on his old team when the game
            // started. Tomorrow's day boundary is past every game
            // that could possibly have already started, so the
            // assignment can never retroactively steal a game.
            var effectiveAt = NextUtcDayStart();

            AddHistoryRow(
                player.Id,
                team.Id,
                season.Id,
                rosterStatus,
                effectiveAt,
                $"Assignment ({rosterStatus})");

            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            return new RosterActionResultDto
            {
                Success = true,
                Message =
                    $"'{PlayerName(player)}' assigned to '{team.Name}' " +
                    $"({rosterStatus}) for {season.Name}.",
                Entry = ToRosterEntryDto(entry)
            };
        }

        public async Task<RosterActionResultDto> MovePlayerAsync(MovePlayerRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return Failure("Season not found. Run POST /api/League/setup first.");
            }

            if (request.EffectiveAt == default)
            {
                return Failure(
                    "EffectiveAt is required. Pass the UTC instant the " +
                    "trade becomes effective.");
            }

            var newTeam = await _dbContext.FantasyTeams
                .FirstOrDefaultAsync(t => t.Id == request.NewFantasyTeamId);

            if (newTeam == null)
            {
                return Failure($"Fantasy team {request.NewFantasyTeamId} not found.");
            }

            var entry = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Include(e => e.FantasyTeam)
                .FirstOrDefaultAsync(e =>
                    e.SeasonId == season.Id &&
                    e.PlayerId == request.PlayerId);

            if (entry == null)
            {
                return Failure(
                    $"No roster entry found for player {request.PlayerId} in {season.Name}. " +
                    "Use POST /api/Roster/assign to add him to a team first.");
            }

            if (entry.FantasyTeamId == newTeam.Id)
            {
                return Failure(
                    $"'{PlayerName(entry.Player)}' is already on '{newTeam.Name}'.");
            }

            var oldTeamId = entry.FantasyTeamId;
            var oldTeamName = entry.FantasyTeam?.Name ?? $"team {entry.FantasyTeamId}";
            var status = entry.RosterStatus;

            entry.FantasyTeamId = newTeam.Id;

            // Append two history rows at the same instant:
            //   - one against the old team, same status, closing out
            //     the old team's ownership of the player;
            //   - one against the new team, same status, opening the
            //     new team's ownership.
            //
            // The recompute reads the last row with EffectiveAt <= game
            // day, so every game before this instant belongs to the
            // old team and every game from this instant belongs to the
            // new team. That is exactly the mid-month trade semantics
            // the league wants.
            //
            // The caller supplies EffectiveAt explicitly here: an
            // admin-driven trade is expected to choose its own day
            // boundary (typically the 1st of a month, per league
            // rules). NormalizeEffectiveAt truncates to day precision
            // without shifting the day.
            var effectiveAt = NormalizeEffectiveAt(request.EffectiveAt);

            var note = string.IsNullOrWhiteSpace(request.Note)
                ? $"Trade from '{oldTeamName}' to '{newTeam.Name}'"
                : request.Note!.Trim();

            AddHistoryRow(
        entry.PlayerId,
        oldTeamId,
        season.Id,
        status,
        effectiveAt,
        note);

            AddHistoryRow(
                entry.PlayerId,
                newTeam.Id,
                season.Id,
                status,
                effectiveAt,
                note);

            // A player who changes fantasy teams can no longer be
            // offered by his old team, nor used as a responding
            // pick by a former manager. Drop every active offer
            // and every pending or accepted response that
            // references him, in the same transaction as the
            // roster move.
            var (offersDeleted, responsesDeleted) =
                await DeleteMarketplaceObjectsInvolvingPlayersAsync(
                    new[] { entry.PlayerId });

            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            return new RosterActionResultDto
            {
                Success = true,
                Message =
                    $"'{PlayerName(entry.Player)}' moved from '{oldTeamName}' " +
                    $"to '{newTeam.Name}' for {season.Name}." +
                    BuildMarketplaceCleanupSuffix(
                        offersDeleted, responsesDeleted),
                Entry = ToRosterEntryDto(entry)
            };
        }

        public async Task<RosterActionResultDto> ReleasePlayerAsync(ReleasePlayerRequest request)
        {
            var entry = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Include(e => e.FantasyTeam)
                .Include(e => e.Season)
                .FirstOrDefaultAsync(e => e.Id == request.RosterEntryId);

            if (entry == null)
            {
                return Failure($"Roster entry {request.RosterEntryId} not found.");
            }

            var message =
                $"'{PlayerName(entry.Player)}' released from " +
                $"'{entry.FantasyTeam?.Name}' ({entry.Season?.Name}).";

            // Append a history row with the terminal Released status
            // BEFORE deleting the RosterEntry, so the recompute stops
            // crediting this player's future games to his old team.
            //
            // Effective TOMORROW 00:00 UTC, not today. A release is
            // not retroactive: any game the player plays today (or
            // that already started today) still belongs to the team
            // that held him when the puck dropped. Tomorrow's day
            // boundary guarantees that, without needing to consult
            // the NHL schedule.
            var effectiveAt = NextUtcDayStart();

            AddHistoryRow(
                entry.PlayerId,
                entry.FantasyTeamId,
                entry.SeasonId,
                RosterStatus.Released,
                effectiveAt,
                "Released");

            _dbContext.RosterEntries.Remove(entry);

            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            return new RosterActionResultDto
            {
                Success = true,
                Message = message,
                Entry = null
            };
        }

        public async Task<RosterActionResultDto> ReleaseAllPlayersAsync(ReleaseAllPlayersRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return Failure("Season not found. Run POST /api/League/setup first.");
            }

            var entries = await _dbContext.RosterEntries
                .Where(e => e.SeasonId == season.Id)
                .ToListAsync();

            if (entries.Count == 0)
            {
                return new RosterActionResultDto
                {
                    Success = true,
                    Message = $"No players are currently assigned to a fantasy team for {season.Name}.",
                    Entry = null
                };
            }

            // Append a terminal Released history row per player before
            // wiping the roster. The recompute reads history, not
            // RosterEntry, so every player would otherwise keep his
            // last Active row and every old team would keep earning
            // FP for him after the reset.
            //
            // Effective TOMORROW 00:00 UTC, same rule as the single
            // release. Today's games still count for the old teams;
            // tomorrow's do not.
            var effectiveAt = NextUtcDayStart();

            foreach (var entry in entries)
            {
                AddHistoryRow(
                    entry.PlayerId,
                    entry.FantasyTeamId,
                    entry.SeasonId,
                    RosterStatus.Released,
                    effectiveAt,
                    "Bulk release (full reset)");
            }

            _dbContext.RosterEntries.RemoveRange(entries);
            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            return new RosterActionResultDto
            {
                Success = true,
                Message = $"Released {entries.Count} players from fantasy teams for {season.Name}.",
                Entry = null
            };
        }

        /// <summary>
        /// Atomically swaps the RosterStatus of two players on the same
        /// fantasy team at the same effective instant. Enforces:
        ///   - both players are on the given team for the given season;
        ///   - both players have a classifiable position group;
        ///   - both players share the same position group
        ///     (F &lt;-&gt; F, D &lt;-&gt; D, G &lt;-&gt; G);
        ///   - the swap does not violate the league shape
        ///     (12/6/1 active + 4/2/1 bench + 3 prospects).
        ///
        /// The two players simply exchange statuses; the caller does not
        /// need to specify which goes where.
        /// </summary>
        public async Task<RosterActionResultDto> SwapRosterStatusAsync(
            SwapRosterStatusRequest request)
        {
            var validation = await ValidateSwapAsync(request);

            if (validation.Failure != null)
            {
                return validation.Failure;
            }

            var entryA = validation.EntryA!;
            var entryB = validation.EntryB!;
            var season = validation.Season!;

            var previousStatusA = entryA.RosterStatus;
            var previousStatusB = entryB.RosterStatus;

            // Exchange. Safe: validation guaranteed two distinct rows.
            entryA.RosterStatus = previousStatusB;
            entryB.RosterStatus = previousStatusA;

            var effectiveAt = NormalizeEffectiveAt(request.EffectiveAt);

            var note = string.IsNullOrWhiteSpace(request.Note)
                ? $"Swap {previousStatusA} <-> {previousStatusB}"
                : request.Note!.Trim();

            AddHistoryRow(
                entryA.PlayerId,
                entryA.FantasyTeamId,
                season.Id,
                entryA.RosterStatus,
                effectiveAt,
                note);

            AddHistoryRow(
                entryB.PlayerId,
                entryB.FantasyTeamId,
                season.Id,
                entryB.RosterStatus,
                effectiveAt,
                note);

            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            return new RosterActionResultDto
            {
                Success = true,
                Message =
                    $"'{PlayerName(entryA.Player!)}' -> {entryA.RosterStatus}, " +
                    $"'{PlayerName(entryB.Player!)}' -> {entryB.RosterStatus}.",
                Entry = ToRosterEntryDto(entryA)
            };
        }

        /// <summary>
        /// Sets a single player's RosterStatus. Escape hatch used for
        /// corrections, backfills, and any case where a swap does not
        /// apply. Validation still enforces the league shape.
        /// </summary>
        public async Task<RosterActionResultDto> SetRosterStatusAsync(
            SetRosterStatusRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return Failure("Season not found. Run POST /api/League/setup first.");
            }

            if (!TryParseRosterStatus(request.NewRosterStatus, out var newStatus))
            {
                return Failure(
                    $"Invalid NewRosterStatus '{request.NewRosterStatus}'. " +
                    "Use Active, Bench or Prospect.");
            }

            var entry = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Include(e => e.FantasyTeam)
                .FirstOrDefaultAsync(e =>
                    e.SeasonId == season.Id &&
                    e.FantasyTeamId == request.FantasyTeamId &&
                    e.PlayerId == request.PlayerId);

            if (entry == null)
            {
                return Failure(
                    $"No roster entry found for player {request.PlayerId} " +
                    $"on team {request.FantasyTeamId} for {season.Name}.");
            }

            if (entry.RosterStatus == newStatus)
            {
                return Failure(
                    $"'{PlayerName(entry.Player!)}' is already {newStatus}.");
            }

            var shapeFailure = await CheckShapeAfterAsync(
                entry.FantasyTeamId,
                season.Id,
                new[] { (entry.Id, newStatus) });

            if (shapeFailure != null)
            {
                return shapeFailure;
            }

            var previousStatus = entry.RosterStatus;

            entry.RosterStatus = newStatus;

            var effectiveAt = NormalizeEffectiveAt(request.EffectiveAt);

            AddHistoryRow(
                entry.PlayerId,
                entry.FantasyTeamId,
                season.Id,
                newStatus,
                effectiveAt,
                request.Note ?? $"Set {previousStatus} -> {newStatus}");

            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            return new RosterActionResultDto
            {
                Success = true,
                Message = $"'{PlayerName(entry.Player!)}' -> {newStatus}.",
                Entry = ToRosterEntryDto(entry)
            };
        }

        // =================================================================
        // Roster shape violations (retrospective audit)
        //
        // Reconstructs every team's shape at every distinct history
        // instant in the season and reports every continuous window
        // where the shape did not match
        // 12F/6D/1G active + 4F/2D/1G bench + 3 prospects.
        //
        // The shape at instant T is derived from RosterStatusHistory
        // exactly the way the scoring recompute derives team
        // ownership: for each player, take the last row with
        // EffectiveAt <= T. This guarantees the audit and the
        // standings agree on who owned whom, when.
        // =================================================================

        /// <summary>
        /// Earliest EffectiveAt the shape audit will consider.
        /// History rows before this instant are ignored, so that
        /// pre-season setup work (initial roster construction,
        /// roster changes made before the league officially
        /// opened) does not appear as a violation.
        ///
        /// Set to the day before the season officially starts:
        /// a roster is legally incomplete on the day before
        /// opening night, and reporting that shape as a
        /// violation is a false positive.
        ///
        /// Change this when the league moves to a new season.
        /// </summary>
        private static readonly DateTime ShapeAuditStartUtc =
            new DateTime(2026, 9, 27, 0, 0, 0, DateTimeKind.Utc);

        /// <summary>
        /// Scans the given season's RosterStatusHistory and returns
        /// every continuous window during which some fantasy team
        /// had the wrong number of players in each (status, position
        /// group) bucket.
        ///
        /// Teams with zero players at a checkpoint are skipped, so
        /// the period before the initial roster is populated and
        /// the state after a full release-all do not appear as
        /// violations.
        ///
        /// Instants are UTC at day precision, matching every other
        /// RosterStatusHistory row.
        /// </summary>
        public async Task<List<RosterShapeViolationDto>>
            FindRosterShapeViolationsAsync(
                int? seasonId,
                CancellationToken ct = default)
        {
            var season = await ResolveSeasonAsync(seasonId);

            if (season == null)
            {
                return new List<RosterShapeViolationDto>();
            }

            // Every history row for the season, ordered. This is the
            // full timeline; everything else is computed in memory.
            var rows = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h => h.SeasonId == season.Id)
                .OrderBy(h => h.EffectiveAt)
                .ThenBy(h => h.Id)
                .ToListAsync(ct);

            if (rows.Count == 0)
            {
                return new List<RosterShapeViolationDto>();
            }

            // Players referenced by the history, in one query.
            var playerIds = rows
                .Select(r => r.PlayerId)
                .Distinct()
                .ToList();

            var players = await _dbContext.Players
                .AsNoTracking()
                .Where(p => playerIds.Contains(p.Id))
                .Select(p => new ShapeCheckPlayer
                {
                    Id = p.Id,
                    NhlPlayerId = p.NhlPlayerId,
                    FirstName = p.FirstName,
                    LastName = p.LastName,
                    Position = p.Position,
                })
                .ToDictionaryAsync(p => p.Id, ct);

            // Fantasy team names, for the DTO. Teams with history
            // rows always have a FantasyTeam row, but the fallback
            // keeps a stray FK-mismatch from crashing the audit.
            var teamIds = rows
                .Select(r => r.FantasyTeamId)
                .Distinct()
                .ToList();

            var teamNames = await _dbContext.FantasyTeams
                .AsNoTracking()
                .Where(t => teamIds.Contains(t.Id))
                .ToDictionaryAsync(
                    t => t.Id,
                    t => t.Name,
                    ct);

            // Group history by player so the effective row at any
            // checkpoint is a small linear scan.
            var rowsByPlayerId = rows
                .GroupBy(r => r.PlayerId)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(r => r.EffectiveAt)
                          .ThenBy(r => r.Id)
                          .ToList());

            // Every distinct instant the history changed, filtered
            // to only include instants at or after the audit start
            // date. Pre-season setup work is not a violation, and
            // evaluating those checkpoints would surface dozens of
            // false positives for teams that were legitimately
            // incomplete while their roster was still being built.
            //
            // Between two consecutive checkpoints, nothing can
            // change: the shape is constant.
            var checkpoints = rows
                .Select(r => r.EffectiveAt)
                .Where(x => x >= ShapeAuditStartUtc)
                .Distinct()
                .OrderBy(x => x)
                .ToList();

            var allViolations = new List<RosterShapeViolationDto>();

            var openViolationByTeamId =
                new Dictionary<int, RosterShapeViolationDto>();

            var previousShapeByTeamId =
                new Dictionary<int, TeamShape>();

            foreach (var checkpoint in checkpoints)
            {
                var currentShapeByTeamId = BuildTeamShapesAtCheckpoint(
                    checkpoint,
                    rowsByPlayerId,
                    players);

                // Union of teams seen before and teams seen now, so
                // a team whose last player just left still gets
                // processed (and its violation closed).
                var allTeamIdsInThisCheckpoint = new HashSet<int>();

                foreach (var tid in previousShapeByTeamId.Keys)
                {
                    allTeamIdsInThisCheckpoint.Add(tid);
                }

                foreach (var tid in currentShapeByTeamId.Keys)
                {
                    allTeamIdsInThisCheckpoint.Add(tid);
                }

                foreach (var teamId in allTeamIdsInThisCheckpoint)
                {
                    previousShapeByTeamId.TryGetValue(
                        teamId, out var previousShape);

                    currentShapeByTeamId.TryGetValue(
                        teamId, out var currentShape);

                    // "Has players" is the gate for the check: an
                    // empty team is either not-yet-populated or a
                    // post-reset state, and neither is a shape
                    // violation.
                    var previousHasPlayers =
                        previousShape != null &&
                        previousShape.Total > 0;

                    var currentHasPlayers =
                        currentShape != null &&
                        currentShape.Total > 0;

                    var previousWrong =
                        previousHasPlayers &&
                        !previousShape!.MatchesLeagueShape();

                    var currentWrong =
                        currentHasPlayers &&
                        !currentShape!.MatchesLeagueShape();

                    if (previousWrong && !currentWrong)
                    {
                        // Shape was fixed at this checkpoint. Close
                        // the open violation.
                        if (openViolationByTeamId.TryGetValue(
                                teamId,
                                out var violation))
                        {
                            violation.EndEffectiveAt = checkpoint;
                            allViolations.Add(violation);
                            openViolationByTeamId.Remove(teamId);
                        }
                    }
                    else if (!previousWrong && currentWrong)
                    {
                        // Shape broke at this checkpoint. Open a new
                        // violation with the current snapshot.
                        var teamName = teamNames.GetValueOrDefault(
                            teamId,
                            $"Team {teamId}");

                        var violation = new RosterShapeViolationDto
                        {
                            FantasyTeamId = teamId,
                            FantasyTeamName = teamName,
                            StartEffectiveAt = checkpoint,
                            ActiveForwards = currentShape!.ActiveF,
                            ActiveDefensemen = currentShape.ActiveD,
                            ActiveGoalies = currentShape.ActiveG,
                            BenchForwards = currentShape.BenchF,
                            BenchDefensemen = currentShape.BenchD,
                            BenchGoalies = currentShape.BenchG,
                            Prospects = currentShape.Prospects,
                            ExpectedActiveForwards = 12,
                            ExpectedActiveDefensemen = 6,
                            ExpectedActiveGoalies = 1,
                            ExpectedBenchForwards = 4,
                            ExpectedBenchDefensemen = 2,
                            ExpectedBenchGoalies = 1,
                            ExpectedProspects = 3,
                            Players = currentShape.Players
                                .OrderBy(p => StatusSortKey(p.RosterStatus))
                                .ThenBy(p => p.PositionGroup)
                                .ThenBy(p => p.LastName)
                                .ToList(),
                        };

                        openViolationByTeamId[teamId] = violation;
                    }
                    // previousWrong && currentWrong: still broken,
                    // nothing to do; the opening snapshot is kept.
                    // !previousWrong && !currentWrong: fine, no-op.
                }

                previousShapeByTeamId = currentShapeByTeamId;
            }

            // Anything still open at the last checkpoint is ongoing:
            // EndEffectiveAt stays null.
            foreach (var violation in openViolationByTeamId.Values)
            {
                allViolations.Add(violation);
            }

            return allViolations
                .OrderBy(v => v.StartEffectiveAt)
                .ThenBy(v => v.FantasyTeamName)
                .ToList();
        }

        private sealed class ShapeCheckPlayer
        {
            public int Id { get; set; }
            public int NhlPlayerId { get; set; }
            public string FirstName { get; set; } = string.Empty;
            public string LastName { get; set; } = string.Empty;
            public string Position { get; set; } = string.Empty;
        }

        private sealed class TeamShape
        {
            public int ActiveF { get; set; }
            public int ActiveD { get; set; }
            public int ActiveG { get; set; }

            public int BenchF { get; set; }
            public int BenchD { get; set; }
            public int BenchG { get; set; }

            public int Prospects { get; set; }

            public int Total =>
                ActiveF + ActiveD + ActiveG +
                BenchF + BenchD + BenchG +
                Prospects;

            public List<RosterShapeViolationPlayerDto> Players { get; }
                = new List<RosterShapeViolationPlayerDto>();

            /// <summary>
            /// Same check as CheckShapeAfterAsync, but expressed on
            /// the reconstructed shape instead of on the current
            /// RosterEntry rows.
            /// </summary>
            public bool MatchesLeagueShape() =>
                ActiveF == 12 &&
                ActiveD == 6 &&
                ActiveG == 1 &&
                BenchF == 4 &&
                BenchD == 2 &&
                BenchG == 1 &&
                Prospects == 3;
        }

        /// <summary>
        /// Builds the shape of every fantasy team at one instant, by
        /// resolving each player's effective history row at that
        /// instant. Uses the same "last row with EffectiveAt <= T"
        /// rule as the scoring recompute, so the audit and the
        /// standings never disagree about who owned whom.
        ///
        /// Released rows are skipped: their FantasyTeamId still
        /// points at the old team, but the player is not on any
        /// team anymore.
        /// </summary>
        private static Dictionary<int, TeamShape> BuildTeamShapesAtCheckpoint(
            DateTime checkpoint,
            Dictionary<int, List<RosterStatusHistory>> rowsByPlayerId,
            Dictionary<int, ShapeCheckPlayer> players)
        {
            var result = new Dictionary<int, TeamShape>();

            foreach (var kvp in rowsByPlayerId)
            {
                var playerId = kvp.Key;
                var playerRows = kvp.Value;

                RosterStatusHistory? effective = null;

                foreach (var row in playerRows)
                {
                    if (row.EffectiveAt <= checkpoint)
                    {
                        effective = row;
                    }
                    else
                    {
                        break;
                    }
                }

                if (effective == null)
                {
                    continue;
                }

                if (effective.RosterStatus == RosterStatus.Released)
                {
                    continue;
                }

                if (!players.TryGetValue(playerId, out var player))
                {
                    continue;
                }

                var group = PositionGroupHelper.Classify(
                    player.Position);

                // Defensive: every writer validates the position
                // before it writes a row, so this should never fire.
                // Skipping a single row is preferable to throwing
                // and losing the whole audit.
                if (group == PositionGroup.Unknown)
                {
                    continue;
                }

                if (!result.TryGetValue(
                        effective.FantasyTeamId,
                        out var shape))
                {
                    shape = new TeamShape();
                    result[effective.FantasyTeamId] = shape;
                }

                switch (effective.RosterStatus)
                {
                    case RosterStatus.Active:
                        switch (group)
                        {
                            case PositionGroup.Forward:
                                shape.ActiveF++;
                                break;
                            case PositionGroup.Defense:
                                shape.ActiveD++;
                                break;
                            case PositionGroup.Goalie:
                                shape.ActiveG++;
                                break;
                        }
                        break;

                    case RosterStatus.Bench:
                        switch (group)
                        {
                            case PositionGroup.Forward:
                                shape.BenchF++;
                                break;
                            case PositionGroup.Defense:
                                shape.BenchD++;
                                break;
                            case PositionGroup.Goalie:
                                shape.BenchG++;
                                break;
                        }
                        break;

                    case RosterStatus.Prospect:
                        // Position-agnostic, matching CheckShapeAfterAsync.
                        shape.Prospects++;
                        break;
                }

                shape.Players.Add(new RosterShapeViolationPlayerDto
                {
                    PlayerId = player.Id,
                    NhlPlayerId = player.NhlPlayerId,
                    FirstName = player.FirstName,
                    LastName = player.LastName,
                    Position = player.Position,
                    PositionGroup = group switch
                    {
                        PositionGroup.Forward => "F",
                        PositionGroup.Defense => "D",
                        PositionGroup.Goalie => "G",
                        _ => "?",
                    },
                    RosterStatus = effective.RosterStatus.ToString(),
                });
            }

            return result;
        }

        private static int StatusSortKey(string status)
        {
            return status switch
            {
                "Active" => 0,
                "Bench" => 1,
                "Prospect" => 2,
                _ => 3,
            };
        }

        /// <summary>
        /// Returns the append-only history of one player for one season,
        /// most recent first. Used by the admin audit view.
        /// </summary>
        public async Task<List<RosterStatusHistoryDto>> GetRosterStatusHistoryAsync(
            int playerId,
            int? seasonId)
        {
            var season = await ResolveSeasonAsync(seasonId);

            if (season == null)
            {
                return new List<RosterStatusHistoryDto>();
            }

            return await _dbContext.RosterStatusHistories
                .Include(h => h.Player)
                .Include(h => h.FantasyTeam)
                .Where(h =>
                    h.PlayerId == playerId &&
                    h.SeasonId == season.Id)
                .OrderByDescending(h => h.EffectiveAt)
                .ThenByDescending(h => h.Id)
                .Select(h => new RosterStatusHistoryDto
                {
                    Id = h.Id,
                    PlayerId = h.PlayerId,
                    PlayerFirstName = h.Player!.FirstName,
                    PlayerLastName = h.Player!.LastName,
                    FantasyTeamId = h.FantasyTeamId,
                    FantasyTeamName = h.FantasyTeam!.Name,
                    SeasonId = h.SeasonId,
                    RosterStatus = h.RosterStatus.ToString(),
                    EffectiveAt = h.EffectiveAt,
                    CreatedAt = h.CreatedAt,
                    Note = h.Note
                })
                .ToListAsync();
        }

        /// <summary>
        /// Returns the FULL movement history of one player across every
        /// season that has history rows. Each row carries the season
        /// name so a cross-season view can group or label it.
        ///
        /// Ordering: newest first (EffectiveAt DESC, then Id DESC).
        ///
        /// Used by the admin page's "Historique des mouvements d'un
        /// joueur" section, which shows one player's status changes
        /// and team changes across his entire tenure in the league.
        /// </summary>
        public async Task<List<RosterStatusHistoryDto>> GetPlayerFullStatusHistoryAsync(
            int playerId,
            CancellationToken ct = default)
        {
            var rows = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Include(h => h.Player)
                .Include(h => h.FantasyTeam)
                .Include(h => h.Season)
                .Where(h => h.PlayerId == playerId)
                .OrderByDescending(h => h.EffectiveAt)
                .ThenByDescending(h => h.Id)
                .ToListAsync(ct);

            return rows
                .Select(h => new RosterStatusHistoryDto
                {
                    Id = h.Id,
                    PlayerId = h.PlayerId,
                    PlayerFirstName = h.Player!.FirstName,
                    PlayerLastName = h.Player!.LastName,
                    FantasyTeamId = h.FantasyTeamId,
                    FantasyTeamName = h.FantasyTeam!.Name,
                    SeasonId = h.SeasonId,
                    SeasonName = h.Season?.Name,
                    RosterStatus = h.RosterStatus.ToString(),
                    EffectiveAt = h.EffectiveAt,
                    CreatedAt = h.CreatedAt,
                    Note = h.Note
                })
                .ToList();
        }

        /// <summary>
        /// One-time seed for turning history on: writes one history row
        /// per current RosterEntry, effective at the given instant.
        /// Skips entries that already have any history row for the season.
        /// </summary>
        public async Task<RosterActionResultDto> BackfillStatusHistoryAsync(
            BackfillStatusHistoryRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return Failure("Season not found. Run POST /api/League/setup first.");
            }

            var entries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Where(e => e.SeasonId == season.Id)
                .ToListAsync();

            var alreadyTracked = (await _dbContext.RosterStatusHistories
                .Where(h => h.SeasonId == season.Id)
                .Select(h => h.PlayerId)
                .Distinct()
                .ToListAsync())
                .ToHashSet();

            var normalized = NormalizeEffectiveAt(request.EffectiveAt);

            var inserted = 0;

            foreach (var entry in entries)
            {
                if (alreadyTracked.Contains(entry.PlayerId))
                {
                    continue;
                }

                AddHistoryRow(
                    entry.PlayerId,
                    entry.FantasyTeamId,
                    season.Id,
                    entry.RosterStatus,
                    normalized,
                    "Backfill from current RosterEntry");

                inserted++;
            }

            await _dbContext.SaveChangesAsync();

            return new RosterActionResultDto
            {
                Success = true,
                Message =
                    $"Backfilled {inserted} history row(s) for {season.Name}."
            };
        }

        /// <summary>
        /// Corrects the EffectiveAt of a RosterStatusHistory row in place.
        ///
        /// Rules:
        ///   - The row's new EffectiveAt must keep it strictly between
        ///     its current predecessor and successor for the same
        ///     (PlayerId, SeasonId). Otherwise the chronological order
        ///     is ambiguous and the edit is refused.
        ///   - If other rows share the row's current EffectiveAt for
        ///     the same (PlayerId, SeasonId) -- which happens on trades,
        ///     where the out-row and in-row share an instant -- they
        ///     are moved to the same new EffectiveAt so the pair stays
        ///     a pair.
        ///
        /// After saving, the caller (the controller) is expected to
        /// trigger the team-totals recompute so standings update.
        /// </summary>
        public async Task<RosterActionResultDto> UpdateStatusHistoryAsync(
     int historyId,
     UpdateRosterStatusHistoryRequest request)
        {
            if (request.EffectiveAt == default)
            {
                return Failure(
                    "EffectiveAt is required. Pass the corrected UTC instant.");
            }

            var row = await _dbContext.RosterStatusHistories
                .FirstOrDefaultAsync(h => h.Id == historyId);

            if (row == null)
            {
                return Failure($"History row {historyId} not found.");
            }

            var normalized = NormalizeEffectiveAt(request.EffectiveAt);

            // Parse the optional status BEFORE we touch anything, so
            // an invalid value rejects the whole request cleanly.
            RosterStatus? parsedStatus = null;

            if (!string.IsNullOrWhiteSpace(request.RosterStatus))
            {
                if (!TryParseRosterStatus(
                        request.RosterStatus, out var s))
                {
                    return Failure(
                        $"Invalid RosterStatus '{request.RosterStatus}'. " +
                        "Use Active, Bench, Prospect or Released.");
                }

                parsedStatus = s;
            }

            // Load the full history for the same player and season so we
            // can (a) check ordering and (b) find any sibling rows that
            // share the current EffectiveAt.
            var siblings = await _dbContext.RosterStatusHistories
                .Where(h =>
                    h.PlayerId == row.PlayerId &&
                    h.SeasonId == row.SeasonId)
                .OrderBy(h => h.EffectiveAt)
                .ThenBy(h => h.Id)
                .ToListAsync();

            var sameInstant = siblings
      .Where(h => h.EffectiveAt == row.EffectiveAt)
      .ToList();

            // Refuse any edit that touches a row owned by a recorded
            // trade. The TradeHistory audit trail ties its
            // RosterStatusHistory rows together; editing one in
            // isolation would desynchronize TradeHistory.EffectiveAt
            // from the actual credit dates. The dedicated
            // ChangeTradeDateAsync endpoint is the correct way to
            // move a trade's date.
            if (sameInstant.Any(h =>
           h.TradeHistoryId != null ||
           h.StatusChangeHistoryId != null))
            {
                return Failure(
                    "Cette ligne d'historique appartient à un échange " +
                    "ou à un changement de statut enregistré. " +
                    "Utilisez le bouton « Modifier la date » dans la " +
                    "section correspondante pour corriger la date.");
            }

            var sameInstantIds = sameInstant
                .Select(h => h.Id)
                .ToHashSet();

            var unaffected = siblings
                .Where(h => !sameInstantIds.Contains(h.Id))
                .ToList();

            // We also need to make sure we are not colliding with an
            // unaffected row exactly at the new instant (which would
            // create two unrelated rows at the same EffectiveAt).
            var collision = unaffected
                .Any(h => h.EffectiveAt == normalized);

            if (collision)
            {
                return Failure(
                    "Another history row for this player already exists " +
                    $"at {normalized:yyyy-MM-dd}. Choose a different date.");
            }

            // Capture the previous state BEFORE any mutation so the
            // success message can describe what actually changed.
            var previousDate = row.EffectiveAt;
            var previousStatus = row.RosterStatus;

            // Apply the status change, if requested, ONLY to the
            // specific row identified by the route id. Siblings can
            // legitimately hold different statuses, so propagating
            // the change would corrupt the record.
            if (parsedStatus.HasValue)
            {
                row.RosterStatus = parsedStatus.Value;
            }

            // Move the EffectiveAt and update the Note on the target
            // row and its siblings. A trade writes two rows at the
            // same instant: they represent one moment, so moving the
            // moment moves both.
            foreach (var sibling in sameInstant)
            {
                sibling.EffectiveAt = normalized;
                sibling.CreatedAt = DateTime.UtcNow;

                if (!string.IsNullOrWhiteSpace(request.Note))
                {
                    sibling.Note = request.Note!.Trim();
                }
            }

            await _dbContext.SaveChangesAsync();

            // Build a message that describes every part of the change.
            var parts = new List<string>
            {
                $"date {previousDate:yyyy-MM-dd} -> {normalized:yyyy-MM-dd}",
                $"{sameInstant.Count} row(s) updated",
            };

            if (parsedStatus.HasValue &&
                parsedStatus.Value != previousStatus)
            {
                parts.Add(
                    $"status {previousStatus} -> {parsedStatus.Value}");
            }

            return new RosterActionResultDto
            {
                Success = true,
                Message = "History updated: " +
                          string.Join("; ", parts) + "."
            };
        }

        /// <summary>
        /// Deletes a RosterStatusHistory row. Also deletes any sibling
        /// row that shares the same (PlayerId, SeasonId, EffectiveAt),
        /// so a trade's out-row and in-row disappear together.
        /// </summary>
        public async Task<RosterActionResultDto> DeleteStatusHistoryAsync(
            int historyId)
        {
            var row = await _dbContext.RosterStatusHistories
                .FirstOrDefaultAsync(h => h.Id == historyId);

            if (row == null)
            {
                return Failure($"History row {historyId} not found.");
            }

            var siblings = await _dbContext.RosterStatusHistories
      .Where(h =>
          h.PlayerId == row.PlayerId &&
          h.SeasonId == row.SeasonId &&
          h.EffectiveAt == row.EffectiveAt)
      .ToListAsync();

            // Refuse to delete rows that belong to a recorded trade.
            // The audit trail must stay intact; if the date is wrong,
            // the admin corrects it via the dedicated date-change
            // endpoint, which moves the rows without removing them.
            if (siblings.Any(h =>
           h.TradeHistoryId != null ||
           h.StatusChangeHistoryId != null))
            {
                return Failure(
                    "Cette ligne d'historique appartient à un échange " +
                    "ou à un changement de statut enregistré et ne peut " +
                    "pas être supprimée. Utilisez « Modifier la date » " +
                    "dans la section correspondante pour corriger la " +
                    "date.");
            }

            _dbContext.RosterStatusHistories.RemoveRange(siblings);

            await _dbContext.SaveChangesAsync();

            return new RosterActionResultDto
            {
                Success = true,
                Message =
                    $"Deleted {siblings.Count} history row(s) at " +
                    $"{row.EffectiveAt:yyyy-MM-dd}."
            };
        }

        public async Task<RosterActionResultDto> UpdateEntryAsync(UpdateRosterEntryRequest request)
        {
            var hasStatus = !string.IsNullOrWhiteSpace(request.RosterStatus);

            if (!hasStatus && request.FantasyTeamId == null && request.RosterSlot == null)
            {
                return Failure(
                    "Nothing to update: provide RosterStatus, FantasyTeamId or RosterSlot. " +
                    "The fantasy salary is always derived from PlayerContracts.");
            }

            var entry = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Include(e => e.FantasyTeam)
                .Include(e => e.Season)
                .FirstOrDefaultAsync(e => e.Id == request.RosterEntryId);

            if (entry == null)
            {
                return Failure($"Roster entry {request.RosterEntryId} not found.");
            }

            // Capture the current state BEFORE any mutation. These values
            // go on the "closing" history row when the team changes, and
            // are used to detect whether the status actually changed.
            var previousStatus = entry.RosterStatus;
            var previousTeamId = entry.FantasyTeamId;
            var previousTeamName =
                entry.FantasyTeam?.Name ?? $"team {entry.FantasyTeamId}";

            // Parse the requested status and detect a change. A status
            // value that matches the current one is treated as "no
            // change" and produces no history row.
            var newStatus = previousStatus;
            var statusChanged = false;

            if (hasStatus)
            {
                if (!TryParseRosterStatus(request.RosterStatus, out newStatus))
                {
                    return Failure(
                        $"Invalid RosterStatus '{request.RosterStatus}'. " +
                        "Use Active, Bench or Prospect.");
                }

                statusChanged = newStatus != previousStatus;
            }

            // Detect a team change. A FantasyTeamId that matches the
            // current team is treated as "no change".
            var teamChanged = false;
            FantasyTeam? targetTeam = null;

            if (request.FantasyTeamId.HasValue &&
                request.FantasyTeamId.Value != entry.FantasyTeamId)
            {
                targetTeam = await _dbContext.FantasyTeams
                    .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId.Value);

                if (targetTeam == null)
                {
                    return Failure($"Fantasy team {request.FantasyTeamId.Value} not found.");
                }

                teamChanged = true;
            }

            // Resolve the EffectiveAt for the history rows that this
            // update may write.
            //
            //   - If the caller supplied one (the AdminPage's combined-
            //     update form always does when the team changes), use
            //     it as-is.
            //   - Otherwise, if the team is changing, refuse the update.
            //     This preserves the existing contract: a team change
            //     must have a caller-chosen effective day, because the
            //     recompute uses it to slice the player's FP between
            //     the two teams.
            //   - Otherwise (status-only change), fall back to
            //     NextUtcDayStart. That keeps the change non-retroactive:
            //     today's games still belong to the pre-change status,
            //     and the new status takes over from tomorrow.
            DateTime effectiveAt;

            if (request.EffectiveAt.HasValue &&
                request.EffectiveAt.Value != default)
            {
                effectiveAt = NormalizeEffectiveAt(request.EffectiveAt.Value);
            }
            else if (teamChanged)
            {
                return Failure(
                    "EffectiveAt is required when the team changes. " +
                    "Pass the UTC instant the trade becomes effective.");
            }
            else
            {
                effectiveAt = NextUtcDayStart();
            }

            // Apply the mutations.
            entry.RosterStatus = newStatus;

            if (teamChanged && targetTeam != null)
            {
                entry.FantasyTeam = targetTeam;
                entry.FantasyTeamId = targetTeam.Id;
            }

            entry.FantasySalary = await ResolveSalaryFromContractsAsync(
                entry.PlayerId,
                entry.Season.NhlSeasonCode);

            if (request.RosterSlot.HasValue)
            {
                entry.RosterSlot = request.RosterSlot.Value;
            }

            // Build the note. The caller's note wins; otherwise a default
            // that describes what the update actually did is generated, so
            // the audit view never shows an unexplained row.
            var defaultNoteParts = new List<string>();

            if (teamChanged)
            {
                defaultNoteParts.Add(
                    $"Trade from '{previousTeamName}' to " +
                    $"'{entry.FantasyTeam?.Name}'");
            }

            if (statusChanged)
            {
                defaultNoteParts.Add($"{previousStatus} -> {newStatus}");
            }

            var note = string.IsNullOrWhiteSpace(request.Note)
                ? (defaultNoteParts.Count > 0
                    ? string.Join(" | ", defaultNoteParts)
                    : "Roster update")
                : request.Note!.Trim();

            // Write the history rows.
            //
            // The scoring recompute walks RosterStatusHistory and credits
            // a game to the player's last Active team at game-day 00:00
            // UTC. Any update that could change "which team, which status"
            // must therefore append at least one row, otherwise the change
            // is invisible to the recompute and old teams would keep
            // earning FP for players they no longer own, or benched
            // players would keep earning FP for their old active slot.
            //
            // Cases:
            //   teamChanged && statusChanged
            //       Close out the old team with the previous status, open
            //       the new team with the new status.
            //   teamChanged only
            //       Close out the old team with its current status, open
            //       the new team with the same status.
            //   statusChanged only
            //       Append one row on the same team with the new status.
            //   neither changed (slot-only update)
            //       No history row: the slot is not part of scoring.
            var offersDeleted = 0;
            var responsesDeleted = 0;

            if (teamChanged)
            {
                AddHistoryRow(
                    entry.PlayerId,
                    previousTeamId,
                    entry.SeasonId,
                    previousStatus,
                    effectiveAt,
                    note);

                AddHistoryRow(
                    entry.PlayerId,
                    entry.FantasyTeamId,
                    entry.SeasonId,
                    newStatus,
                    effectiveAt,
                    note);

                // Marketplace cleanup: any active offer or pending
                // response that references this player is now stale,
                // because his old team no longer owns him.
                (offersDeleted, responsesDeleted) =
                    await DeleteMarketplaceObjectsInvolvingPlayersAsync(
                        new[] { entry.PlayerId });
            }
            else if (statusChanged)
            {
                AddHistoryRow(
                    entry.PlayerId,
                    entry.FantasyTeamId,
                    entry.SeasonId,
                    newStatus,
                    effectiveAt,
                    note);
            }

            await _dbContext.SaveChangesAsync();

            OnRosterChanged();

            var marketplaceSuffix =
                BuildMarketplaceCleanupSuffix(
                    offersDeleted, responsesDeleted);

            return new RosterActionResultDto
            {
                Success = true,
                Message = teamChanged
                    ? $"'{PlayerName(entry.Player)}' transferred to '{entry.FantasyTeam?.Name}'." +
                        marketplaceSuffix
                    : statusChanged
                        ? $"'{PlayerName(entry.Player)}' set to {newStatus} on '{entry.FantasyTeam?.Name}'."
                        : $"'{PlayerName(entry.Player)}' updated on '{entry.FantasyTeam?.Name}'.",
                Entry = ToRosterEntryDto(entry)
            };
        }

        /// <summary>
        /// Roster payload, cached for 20 seconds. Every mutation in
        /// this service invalidates the cache via OnRosterChanged, so
        /// the only staleness window is a mutation made through a
        /// different code path — which there isn't.
        /// </summary>
        private static readonly TimeSpan RosterCacheTtl =
            TimeSpan.FromSeconds(20);

        public async Task<TeamRosterDto?> GetTeamRosterAsync(
            int fantasyTeamId,
            int? seasonId)
        {
            var cacheKey = seasonId.HasValue
                ? $"roster:{fantasyTeamId}:{seasonId.Value}"
                : $"roster:{fantasyTeamId}:current";

            return await _cache.GetOrCreateAsync(
                cacheKey,
                RosterCacheTtl,
                () => BuildTeamRosterAsync(fantasyTeamId, seasonId));
        }

        private async Task<TeamRosterDto?> BuildTeamRosterAsync(
            int fantasyTeamId,
            int? seasonId)
        {
            var team = await _dbContext.FantasyTeams
      .AsNoTracking()
      .Include(t => t.League)
      .FirstOrDefaultAsync(t => t.Id == fantasyTeamId);

            if (team == null)
            {
                return null;
            }

            var season = await ResolveSeasonAsync(seasonId);

            if (season == null)
            {
                return null;
            }

            // NOTE: intentionally tracked. This list is the one thing
            // GetTeamRosterAsync may modify (FantasySalary) and save.
            var entries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                    .ThenInclude(p => p.NhlTeam)
                .Where(e =>
                    e.FantasyTeamId == fantasyTeamId &&
                    e.SeasonId == season.Id)
                .ToListAsync();

            var orderedEntries = entries
                .OrderBy(e => e.RosterStatus)
                .ThenBy(e => e.RosterSlot)
                .ThenBy(e => e.Player.LastName)
                .ToList();

            var cardSeasons = await _dbContext.Seasons
           .AsNoTracking()
           .Where(s =>
               s.NhlSeasonCode == TwoSeasonsAgoNhlCode ||
               s.NhlSeasonCode == PreviousSeasonNhlCode ||
               s.NhlSeasonCode == CurrentSeasonNhlCode)
           .ToListAsync();

            var twoSeasonsAgoSeason = cardSeasons
                .FirstOrDefault(s => s.NhlSeasonCode == TwoSeasonsAgoNhlCode);
            var previousSeason = cardSeasons
                .FirstOrDefault(s => s.NhlSeasonCode == PreviousSeasonNhlCode);
            var currentSeason = cardSeasons
                .FirstOrDefault(s => s.NhlSeasonCode == CurrentSeasonNhlCode);

            var playerIds = entries.Select(e => e.PlayerId).ToList();

            var careerRows = new List<PlayerCareerStat>();

            if (playerIds.Count > 0)
            {
                careerRows = await _dbContext.PlayerCareerStats
                     .AsNoTracking()
                     .Where(s =>
                         playerIds.Contains(s.PlayerId) &&
                         (s.Season == TwoSeasonsAgoNhlCode ||
                          s.Season == PreviousSeasonNhlCode ||
                          s.Season == CurrentSeasonNhlCode) &&
                         s.GameTypeId == 2)
                     .ToListAsync();
            }

            // Load PlayerSeasonStat rows for the same three card
            // seasons so the lineup section can surface fantasy
            // points, hat tricks and shutouts, which are not on
            // PlayerCareerStat.
            var cardSeasonIds = new Dictionary<int, int>();

            if (twoSeasonsAgoSeason != null)
                cardSeasonIds[TwoSeasonsAgoNhlCode] = twoSeasonsAgoSeason.Id;

            if (previousSeason != null)
                cardSeasonIds[PreviousSeasonNhlCode] = previousSeason.Id;

            if (currentSeason != null)
                cardSeasonIds[CurrentSeasonNhlCode] = currentSeason.Id;

            var seasonStatByPlayerAndSeasonCode =
                new Dictionary<(int PlayerId, int SeasonCode), PlayerSeasonStat>();

            if (playerIds.Count > 0 && cardSeasonIds.Count > 0)
            {
                var cardSeasonIdList = cardSeasonIds.Values.ToList();

                var seasonStatRows = await _dbContext.PlayerSeasonStats
                    .AsNoTracking()
                    .Where(s =>
                        playerIds.Contains(s.PlayerId) &&
                        cardSeasonIdList.Contains(s.SeasonId))
                    .ToListAsync();

                var seasonIdToCode = cardSeasonIds
                    .ToDictionary(kv => kv.Value, kv => kv.Key);

                foreach (var row in seasonStatRows)
                {
                    if (seasonIdToCode.TryGetValue(row.SeasonId, out var code))
                    {
                        seasonStatByPlayerAndSeasonCode[(row.PlayerId, code)] = row;
                    }
                }
            }

            var leagueLines = careerRows
     .GroupBy(s => new
     {
         s.PlayerId,
         s.Season,
         s.LeagueAbbreviation
     })
     .Select(g =>
     {
         // Weighted average ATOI across the group's rows.
         // A mid-season trade splits one season into
         // several Sequence rows; weighting by games
         // played makes a 30-game stint at 20:00 and a
         // 50-game stint at 15:00 average out to the
         // season-long 16:52, not the naive 17:30.
         //
         // Rows whose ATOI is missing or unparsable are
         // skipped entirely so they do not drag the
         // average toward zero. Null when no usable row
         // was found: the frontend renders a dash then.
         var weightedSeconds = 0;
         var weightedGames = 0;

         foreach (var row in g)
         {
             var seconds = ParseToiSeconds(
                 row.AverageTimeOnIce);

             if (seconds > 0 && row.GamesPlayed > 0)
             {
                 weightedSeconds +=
                     seconds * row.GamesPlayed;
                 weightedGames += row.GamesPlayed;
             }
         }

         string? aggregatedToi =
             weightedGames > 0
                 ? FormatToiSeconds(
                     weightedSeconds / weightedGames)
                 : null;

         return new CardStatLine
         {
             PlayerId = g.Key.PlayerId,
             Season = g.Key.Season,
             LeagueAbbreviation = g.Key.LeagueAbbreviation,
             GamesPlayed = g.Sum(s => s.GamesPlayed),
             Goals = g.Sum(s => s.Goals),
             Assists = g.Sum(s => s.Assists),
             Points = g.Sum(s => s.Points),
             Wins = g.Sum(s => s.Wins),
             Losses = g.Sum(s => s.Losses),
             OvertimeLosses = g.Sum(s => s.OvertimeLosses),
             HatTricks = g.Sum(s => s.HatTricks ?? 0),
             Shutouts = g.Sum(s => s.Shutouts),
             TimeOnIce = aggregatedToi,
         };
     })
     .ToList();

            var chosenLines = leagueLines
                .GroupBy(l => new { l.PlayerId, l.Season })
                .Select(g => g
                    .OrderByDescending(l => l.LeagueAbbreviation == "NHL")
                    .ThenByDescending(l => l.GamesPlayed)
                    .First())
                .ToList();

            var twoSeasonsAgoStatsByPlayerId = new Dictionary<int, CardStatLine>();
            var lastStatsByPlayerId = new Dictionary<int, CardStatLine>();
            var currentStatsByPlayerId = new Dictionary<int, CardStatLine>();

            foreach (var line in chosenLines)
            {
                if (line.Season == TwoSeasonsAgoNhlCode)
                {
                    twoSeasonsAgoStatsByPlayerId[line.PlayerId] = line;
                }
                else if (line.Season == PreviousSeasonNhlCode)
                {
                    lastStatsByPlayerId[line.PlayerId] = line;
                }
                else if (line.Season == CurrentSeasonNhlCode)
                {
                    currentStatsByPlayerId[line.PlayerId] = line;
                }
            }

            // Overlay PlayerSeasonStat for the current season.
            //
            // PlayerSeasonStat is the live-tracked table: the live
            // refresh writes incremental updates to it during games
            // and UpdatePlayerSeasonStatsAsync recomputes it from
            // PlayerGameLog. PlayerCareerStat is the historical
            // archive and only refreshes when the landing page is
            // re-synced, which can be hours behind. For the current
            // season, PlayerSeasonStat always wins for the counting
            // stats (GP / G / A / PTS / W / L / OTL).
            //
            // TimeOnIce is different. PlayerSeasonStat has no ATOI
            // column, so the archive is the only source for TOI on
            // the current season too. When we replace the archive-
            // derived line with the live one, we have to carry the
            // archive's TimeOnIce forward, otherwise the popup shows
            // a dash for every player whose live row exists — which
            // is every player with at least one game log this year.
            foreach (var kvp in seasonStatByPlayerAndSeasonCode)
            {
                var (playerId, seasonCode) = kvp.Key;

                if (seasonCode != CurrentSeasonNhlCode)
                {
                    continue;
                }

                var stat = kvp.Value;

                // Grab the archive-derived line for this player
                // before we overwrite it. It may not exist (player
                // has a live row but no archive row yet), in which
                // case TimeOnIce stays null and the frontend
                // renders a dash, which is correct.
                currentStatsByPlayerId.TryGetValue(
                    playerId,
                    out var previousArchiveLine);

                currentStatsByPlayerId[playerId] = new CardStatLine
                {
                    PlayerId = playerId,
                    Season = CurrentSeasonNhlCode,
                    LeagueAbbreviation = "NHL",
                    GamesPlayed = stat.GamesPlayed,
                    Goals = stat.Goals,
                    Assists = stat.Assists,
                    Points = stat.Points,
                    Wins = stat.Wins,
                    Losses = stat.Losses,
                    OvertimeLosses = stat.OvertimeLosses,
                    TimeOnIce = previousArchiveLine?.TimeOnIce,
                };
            }

            var contractsByPlayerId = new Dictionary<int, List<PlayerContract>>();

            if (playerIds.Count > 0)
            {
                var contracts = await _dbContext.PlayerContracts
                     .AsNoTracking()
                     .Where(c => playerIds.Contains(c.PlayerId))
                     .ToListAsync();

                contractsByPlayerId = contracts
                    .GroupBy(c => c.PlayerId)
                    .ToDictionary(g => g.Key, g => g.ToList());
            }

            // Yesterday / today fantasy points per player.
            //
            // The two dates are the backend's current fantasy date
            // and the day before it. The fantasy date is the real ET
            // calendar date, except between 00:00 and 03:00 ET, when
            // it stays on the previous calendar day. That cutoff is
            // what makes the "HIER" and "AJD" columns on the roster
            // cards flip at 3 AM ET instead of at midnight, matching
            // the same columns in the standings table and the two
            // player tables on the Classement page.
            //
            // PlayerGameLog.GameDate stores the real ET calendar date
            // the game started on (written by NhlGameService.
            // BuildSnapshot), so a query for GameDate == today returns
            // every game that started on the fantasy date. A game
            // that started at 22:30 ET and is still running at 01:00
            // ET is still a "today" game under this rule, exactly as
            // the league wants.
            var nowUtc = DateTime.UtcNow;
            var today = NhlFantasyLeague.api.Services.NHL.TimeZoneHelper
                .GetFantasyDateEt(nowUtc);
            var yesterday = today.AddDays(-1);

            var recentLogs = new List<RecentGameLogRow>();

            if (playerIds.Count > 0)
            {
                recentLogs = await _dbContext.PlayerGameLogs
                     .AsNoTracking()
                     .Where(g =>
                         playerIds.Contains(g.PlayerId) &&
                         (g.GameDate == today || g.GameDate == yesterday))
                     .Select(g => new RecentGameLogRow
                     {
                         PlayerId = g.PlayerId,
                         GameDate = g.GameDate,
                         FantasyPoints = g.FantasyPoints
                     })
                     .ToListAsync();
            }

            var yesterdayFpByPlayerId = recentLogs
                .Where(g => g.GameDate == yesterday)
                .GroupBy(g => g.PlayerId)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.FantasyPoints));

            var todayFpByPlayerId = recentLogs
                .Where(g => g.GameDate == today)
                .GroupBy(g => g.PlayerId)
                .ToDictionary(g => g.Key, g => g.Sum(x => x.FantasyPoints));

            var salaryChanged = false;

            foreach (var entry in entries)
            {
                var contracts = contractsByPlayerId.GetValueOrDefault(entry.PlayerId)
                    ?? new List<PlayerContract>();

                var derivedSalary = ResolveSalaryFromContracts(
                    contracts,
                    season.NhlSeasonCode);

                if (entry.FantasySalary != derivedSalary)
                {
                    entry.FantasySalary = derivedSalary;
                    salaryChanged = true;
                }
            }

            if (salaryChanged)
            {
                await _dbContext.SaveChangesAsync();
            }

            var capPlayers = entries
                .Where(e => e.RosterStatus != RosterStatus.Prospect)
                .ToList();

            var projectedSeasonCodes = Enumerable
                .Range(0, FutureCapSeasonCount)
                .Select(i => AddSeasons(CurrentSeasonNhlCode, i))
                .ToList();

            var capBySeasonCode = await _dbContext.Seasons
                 .AsNoTracking()
                 .Where(s => projectedSeasonCodes.Contains(s.NhlSeasonCode))
                 .ToDictionaryAsync(s => s.NhlSeasonCode, s => s.SalaryCap);

            var fallbackCap = season.SalaryCap;

            var futureCapBySeason = new List<SeasonCapDto>();

            for (int i = 0; i < FutureCapSeasonCount; i++)
            {
                var seasonCode = projectedSeasonCodes[i];

                decimal seasonSalary = 0m;
                int signedPlayers = 0;

                foreach (var entry in capPlayers)
                {
                    var contracts = contractsByPlayerId.GetValueOrDefault(entry.PlayerId)
                        ?? new List<PlayerContract>();

                    var salary = ResolveSalaryForSeason(contracts, seasonCode);

                    if (salary > 0m)
                    {
                        seasonSalary += salary;
                        signedPlayers++;
                    }
                }

                var cap = capBySeasonCode.TryGetValue(seasonCode, out var storedCap) && storedCap > 0m
                    ? storedCap
                    : fallbackCap;

                futureCapBySeason.Add(new SeasonCapDto
                {
                    NhlSeasonCode = seasonCode,
                    Label = ShortSeasonLabel(seasonCode),
                    CapSalary = seasonSalary,
                    SalaryCap = cap,
                    SignedPlayers = signedPlayers
                });
            }

            return new TeamRosterDto
            {
                FantasyTeamId = team.Id,
                FantasyTeamName = team.Name,
                SeasonId = season.Id,
                SeasonName = season.Name,
                LeagueMaximumRosterSize = team.League?.MaximumRosterSize ?? 0,
                LeagueProspectCount = team.League?.ProspectCount ?? 0,
                TotalPlayers = entries.Count,
                ActiveCount = entries.Count(e => e.RosterStatus == RosterStatus.Active),
                BenchCount = entries.Count(e => e.RosterStatus == RosterStatus.Bench),
                ProspectCount = entries.Count(e => e.RosterStatus == RosterStatus.Prospect),
                TotalSalary = entries.Sum(e => e.FantasySalary),
                CapSalary = entries
                    .Where(e => e.RosterStatus != RosterStatus.Prospect)
                    .Sum(e => e.FantasySalary),
                FutureCapBySeason = futureCapBySeason,
                Entries = orderedEntries
                    .Select(e =>
                    {
                        var contracts = contractsByPlayerId.GetValueOrDefault(e.PlayerId)
                            ?? new List<PlayerContract>();

                        var (currentContract, secondContract) =
                            ResolveContractLines(contracts, season.NhlSeasonCode);

                        // null = did not play; 0 = played, no points.
                        // The dictionaries only contain players who
                        // have a game log row for that day, so a
                        // missing key maps correctly to null.
                        int? yesterdayFp = yesterdayFpByPlayerId
                            .TryGetValue(e.PlayerId, out var yFp)
                            ? yFp
                            : null;

                        int? todayFp = todayFpByPlayerId
                            .TryGetValue(e.PlayerId, out var tFp)
                            ? tFp
                            : null;

                        return ToRosterEntryDto(
                            e,
                            ToSeasonStatLineDto(
                                twoSeasonsAgoSeason,
                                twoSeasonsAgoStatsByPlayerId.GetValueOrDefault(e.PlayerId),
                                seasonStatByPlayerAndSeasonCode.GetValueOrDefault(
                                    (e.PlayerId, TwoSeasonsAgoNhlCode))),
                            ToSeasonStatLineDto(
                                previousSeason,
                                lastStatsByPlayerId.GetValueOrDefault(e.PlayerId),
                                seasonStatByPlayerAndSeasonCode.GetValueOrDefault(
                                    (e.PlayerId, PreviousSeasonNhlCode))),
                            ToSeasonStatLineDto(
                                currentSeason,
                                currentStatsByPlayerId.GetValueOrDefault(e.PlayerId),
                                seasonStatByPlayerAndSeasonCode.GetValueOrDefault(
                                    (e.PlayerId, CurrentSeasonNhlCode))),
                            currentContract,
                            secondContract,
                            yesterdayFp,
                            todayFp);
                    })
                    .ToList()
            };
        }

        /// <summary>
        /// Returns the fantasy team's roster as it stood on a specific
        /// calendar date (ET, day precision): the players who had any
        /// non-Released status on that team at 00:00 UTC of that day,
        /// each with the status they held at that moment.
        ///
        /// Uses the same tie-break rule as the season recompute so the
        /// form dropdowns and the standings never disagree: sort each
        /// player's history by (EffectiveAt, Id), take the last row
        /// whose EffectiveAt is &lt;= the target date. That row's
        /// FantasyTeamId determines the team, and its RosterStatus is
        /// the status that player had at the moment.
        ///
        /// Not cached: the view changes with every roster mutation
        /// and the date varies per request.
        /// </summary>
        public async Task<TeamRosterDto?> GetTeamRosterAtDateAsync(
            int fantasyTeamId,
            DateOnly asOfDate,
            int? seasonId,
            CancellationToken ct = default)
        {
            var team = await _dbContext.FantasyTeams
                .AsNoTracking()
                .Include(t => t.League)
                .FirstOrDefaultAsync(t => t.Id == fantasyTeamId, ct);

            if (team == null)
            {
                return null;
            }

            var season = await ResolveSeasonAsync(seasonId);

            if (season == null)
            {
                return null;
            }

            var dayStartUtc = new DateTime(
                asOfDate.Year, asOfDate.Month, asOfDate.Day,
                0, 0, 0, DateTimeKind.Utc);

            // 1. Every history row for the season, grouped by player
            //    and ordered so the "last row <= asOfDate" rule can
            //    be applied in one pass.
            var allHistory = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h => h.SeasonId == season.Id)
                .ToListAsync(ct);

            var effectiveByPlayerId =
                new Dictionary<int, RosterStatusHistory>();

            foreach (var group in allHistory.GroupBy(h => h.PlayerId))
            {
                RosterStatusHistory? effective = null;

                foreach (var row in group
                    .OrderBy(h => h.EffectiveAt)
                    .ThenBy(h => h.Id))
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

                if (effective != null)
                {
                    effectiveByPlayerId[group.Key] = effective;
                }
            }

            // 2. Filter to players whose effective row pointed at the
            //    target team and was not Released.
            var relevantPlayerIds = effectiveByPlayerId
                .Where(kv =>
                    kv.Value.FantasyTeamId == fantasyTeamId &&
                    kv.Value.RosterStatus != RosterStatus.Released)
                .Select(kv => kv.Key)
                .ToList();

            // 3. Load the player rows, contracts, and current entries
            //    for those players.
            var players = relevantPlayerIds.Count > 0
                ? await _dbContext.Players
                    .AsNoTracking()
                    .Include(p => p.NhlTeam)
                    .Where(p => relevantPlayerIds.Contains(p.Id))
                    .ToListAsync(ct)
                : new List<Player>();

            var playersById = players.ToDictionary(p => p.Id);

            var contracts = relevantPlayerIds.Count > 0
                ? await _dbContext.PlayerContracts
                    .AsNoTracking()
                    .Where(c => relevantPlayerIds.Contains(c.PlayerId))
                    .ToListAsync(ct)
                : new List<PlayerContract>();

            var contractsByPlayerId = contracts
                .GroupBy(c => c.PlayerId)
                .ToDictionary(g => g.Key, g => g.ToList());

            // Current RosterEntry rows only exist for players still on
            // this team today. Players traded away have none, in which
            // case we compute their salary from contracts.
            var currentEntries = relevantPlayerIds.Count > 0
                ? await _dbContext.RosterEntries
                    .AsNoTracking()
                    .Where(e =>
                        e.SeasonId == season.Id &&
                        e.FantasyTeamId == fantasyTeamId &&
                        relevantPlayerIds.Contains(e.PlayerId))
                    .ToListAsync(ct)
                : new List<RosterEntry>();

            var currentEntryByPlayerId = currentEntries
                .ToDictionary(e => e.PlayerId);

            // 4. Build the entries, one per player, with their
            //    historical status.
            var entries = new List<RosterEntryDto>(
                relevantPlayerIds.Count);

            foreach (var playerId in relevantPlayerIds)
            {
                if (!playersById.TryGetValue(playerId, out var player))
                {
                    continue;
                }

                var effective = effectiveByPlayerId[playerId];

                currentEntryByPlayerId.TryGetValue(
                    playerId, out var currentEntry);

                var playerContracts =
                    contractsByPlayerId.GetValueOrDefault(playerId)
                    ?? new List<PlayerContract>();

                var (currentContract, secondContract) =
                    ResolveContractLines(
                        playerContracts, season.NhlSeasonCode);

                var fantasySalary =
                    currentEntry?.FantasySalary
                    ?? ResolveSalaryFromContracts(
                        playerContracts, season.NhlSeasonCode);

                entries.Add(new RosterEntryDto
                {
                    Id = currentEntry?.Id ?? 0,
                    FantasyTeamId = fantasyTeamId,
                    PlayerId = player.Id,
                    NhlPlayerId = player.NhlPlayerId,
                    FirstName = player.FirstName,
                    LastName = player.LastName,
                    Position = player.Position,
                    Age = CalculatePlayerAge(player.BirthDate),
                    NhlTeamAbbreviation =
                        player.NhlTeam?.Abbreviation ?? string.Empty,
                    RosterStatus = effective.RosterStatus.ToString(),
                    RosterSlot = currentEntry?.RosterSlot ?? 0,
                    FantasySalary = fantasySalary,
                    HeadshotUrl = player.HeadshotUrl,
                    RosterLocation =
                        player.RosterLocation?.ToString(),
                    IsInjured = player.IsInjured,
                    InjuryStatus = player.InjuryStatus,
                    InjuryKind = player.InjuryKind.ToString(),
                    InjuryShortDescription =
                        player.InjuryShortDescription,
                    InjuryLongDescription =
                        player.InjuryLongDescription,
                    InjuryType = player.InjuryType,
                    InjuryDetail = player.InjuryDetail,
                    InjurySide = player.InjurySide,
                    InjuryReturnDate = player.InjuryReturnDate,
                    InjuryFantasyStatus = player.InjuryFantasyStatus,
                    TwoSeasonsAgo = null,
                    LastSeason = null,
                    CurrentSeason = null,
                    CurrentContract = currentContract,
                    SecondContract = secondContract,
                    YesterdayFantasyPoints = null,
                    TodayFantasyPoints = null,
                });
            }

            var orderedEntries = entries
                .OrderBy(e => e.RosterStatus)
                .ThenBy(e => e.RosterSlot)
                .ThenBy(e => e.LastName)
                .ToList();

            // 5. Aggregates (recomputed from the historical snapshot
            //    so the DTO is self-consistent).
            var capEntries = orderedEntries
                .Where(e => e.RosterStatus != "Prospect")
                .ToList();

            var projectedSeasonCodes = Enumerable
                .Range(0, FutureCapSeasonCount)
                .Select(i => AddSeasons(season.NhlSeasonCode, i))
                .ToList();

            var capBySeasonCode = await _dbContext.Seasons
                .AsNoTracking()
                .Where(s =>
                    projectedSeasonCodes.Contains(s.NhlSeasonCode))
                .ToDictionaryAsync(
                    s => s.NhlSeasonCode, s => s.SalaryCap, ct);

            var fallbackCap = season.SalaryCap;

            var futureCapBySeason = new List<SeasonCapDto>();

            for (int i = 0; i < FutureCapSeasonCount; i++)
            {
                var seasonCode = projectedSeasonCodes[i];

                decimal seasonSalary = 0m;
                int signedPlayers = 0;

                foreach (var e in capEntries)
                {
                    var playerContracts =
                        contractsByPlayerId.GetValueOrDefault(
                            e.PlayerId)
                        ?? new List<PlayerContract>();

                    var salary = ResolveSalaryForSeason(
                        playerContracts, seasonCode);

                    if (salary > 0m)
                    {
                        seasonSalary += salary;
                        signedPlayers++;
                    }
                }

                var cap =
                    capBySeasonCode.TryGetValue(
                        seasonCode, out var storedCap) &&
                    storedCap > 0m
                        ? storedCap
                        : fallbackCap;

                futureCapBySeason.Add(new SeasonCapDto
                {
                    NhlSeasonCode = seasonCode,
                    Label = ShortSeasonLabel(seasonCode),
                    CapSalary = seasonSalary,
                    SalaryCap = cap,
                    SignedPlayers = signedPlayers,
                });
            }

            return new TeamRosterDto
            {
                FantasyTeamId = team.Id,
                FantasyTeamName = team.Name,
                SeasonId = season.Id,
                SeasonName = season.Name,
                LeagueMaximumRosterSize =
                    team.League?.MaximumRosterSize ?? 0,
                LeagueProspectCount =
                    team.League?.ProspectCount ?? 0,
                TotalPlayers = orderedEntries.Count,
                ActiveCount = orderedEntries
                    .Count(e => e.RosterStatus == "Active"),
                BenchCount = orderedEntries
                    .Count(e => e.RosterStatus == "Bench"),
                ProspectCount = orderedEntries
                    .Count(e => e.RosterStatus == "Prospect"),
                TotalSalary = orderedEntries
                    .Sum(e => e.FantasySalary),
                CapSalary = capEntries
                    .Sum(e => e.FantasySalary),
                FutureCapBySeason = futureCapBySeason,
                Entries = orderedEntries,
            };
        }

        public async Task<List<PlayerSearchResultDto>> SearchPlayersAsync(
         string? search,
         int limit = 20)
        {
            if (string.IsNullOrWhiteSpace(search))
            {
                return new List<PlayerSearchResultDto>();
            }

            var take = Math.Clamp(limit, 1, 50);

            // Split the input on whitespace so a query like
            // "Connor McDavid" becomes ["Connor", "McDavid"]. Every
            // token must match EITHER the first name OR the last name,
            // which lets "connor mc" find Connor McDavid and also lets
            // "mcdavid connor" find him even though the order is
            // reversed.
            var tokens = search
                .Trim()
                .Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries |
                    StringSplitOptions.TrimEntries);

            var playersQuery = _dbContext.Players
                .Include(p => p.NhlTeam)
                .AsQueryable();

            foreach (var token in tokens)
            {
                var pattern = $"%{token}%";

                playersQuery = playersQuery.Where(p =>
                    EF.Functions.ILike(p.FirstName, pattern) ||
                    EF.Functions.ILike(p.LastName, pattern));
            }

            var players = await playersQuery
                .AsNoTracking()
                .OrderBy(p => p.LastName)
                .ThenBy(p => p.FirstName)
                .Take(take)
                .ToListAsync();

            var playerIds = players.Select(p => p.Id).ToList();

            // Current season is looked up by season code, not by
            // "latest StartDate" — see the note in
            // GetRosterGameStatsForDateAsync.
            var currentSeason = await Data.SeasonQueries
                .GetCurrentSeasonAsync(_dbContext);

            var currentEntryByPlayerId = new Dictionary<int, RosterEntry>();

            if (currentSeason != null && playerIds.Count > 0)
            {
                var entries = await _dbContext.RosterEntries
                  .AsNoTracking()
                  .Include(e => e.FantasyTeam)
                  .Where(e =>
                      e.SeasonId == currentSeason.Id &&
                      playerIds.Contains(e.PlayerId))
                  .ToListAsync();

                foreach (var entry in entries)
                {
                    currentEntryByPlayerId[entry.PlayerId] = entry;
                }
            }

            return players
                .Select(p =>
                {
                    currentEntryByPlayerId.TryGetValue(p.Id, out var entry);

                    return new PlayerSearchResultDto
                    {
                        PlayerId = p.Id,
                        NhlPlayerId = p.NhlPlayerId,
                        FirstName = p.FirstName,
                        LastName = p.LastName,
                        Position = p.Position,
                        NhlTeamAbbreviation = p.NhlTeam?.Abbreviation ?? string.Empty,
                        FantasyTeamId = entry?.FantasyTeamId,
                        FantasyTeamName = entry?.FantasyTeam?.Name,
                        RosterEntryId = entry?.Id,
                        RosterStatus = entry?.RosterStatus.ToString(),

                        // Injury fields. The search result carries them so
                        // a future injuries page can reuse the same payload.
                        IsInjured = p.IsInjured,
                        InjuryStatus = p.InjuryStatus,
                        InjuryKind = p.InjuryKind.ToString(),
                        InjuryShortDescription = p.InjuryShortDescription,
                        InjuryLongDescription = p.InjuryLongDescription,
                        InjuryType = p.InjuryType,
                        InjuryDetail = p.InjuryDetail,
                        InjurySide = p.InjurySide,
                        InjuryReturnDate = p.InjuryReturnDate,
                        InjuryFantasyStatus = p.InjuryFantasyStatus
                    };
                })
                .ToList();
        }

        /// <summary>
        /// Returns the fantasy team that currently owns each of the
        /// given NHL players in the current season. Players who are
        /// free agents (or unknown) are simply omitted from the
        /// result, so callers can treat a missing entry as "no team".
        ///
        /// Used by the Game Day page to display the fantasy team
        /// name next to each player in an expanded boxscore.
        ///
        /// Caps the input at 200 ids defensively; a single NHL
        /// boxscore has at most ~40 players.
        /// </summary>
        /// <summary>
        /// TTL for the ownership lookup cache. Ownership changes
        /// only on a roster mutation, and every mutation path in
        /// this service calls OnRosterChanged, which invalidates
        /// the "ownership:" prefix. The TTL is a backstop for any
        /// future code path that bypasses that invalidation; in
        /// normal operation the entry is dropped the moment it
        /// becomes stale.
        /// </summary>
        private static readonly TimeSpan OwnershipCacheTtl =
            TimeSpan.FromMinutes(2);

        public async Task<List<PlayerOwnershipRowDto>> GetPlayerOwnershipAsync(
            IReadOnlyList<int> nhlPlayerIds,
            CancellationToken ct = default)
        {
            if (nhlPlayerIds.Count == 0)
            {
                return new List<PlayerOwnershipRowDto>();
            }

            // Sorted ids make the cache key stable across callers
            // that pass the same set in different orders, so a
            // boxscore's ownership lookup hits the cache on every
            // repeat view of the same game.
            var ids = nhlPlayerIds
                .Distinct()
                .OrderBy(x => x)
                .Take(200)
                .ToList();

            var cacheKey = "ownership:" + string.Join(",", ids);

            return await _cache.GetOrCreateAsync(
                cacheKey,
                OwnershipCacheTtl,
                () => BuildPlayerOwnershipAsync(ids, ct));
        }

        private async Task<List<PlayerOwnershipRowDto>>
            BuildPlayerOwnershipAsync(
                List<int> ids,
                CancellationToken ct)
        {
            // Current season is looked up by season code, not by
            // "latest StartDate" — see the note in
            // GetRosterGameStatsForDateAsync.
            var currentSeason = await Data.SeasonQueries
                .GetCurrentSeasonAsync(_dbContext, ct);

            if (currentSeason == null)
            {
                return new List<PlayerOwnershipRowDto>();
            }

            return await _dbContext.RosterEntries
                .AsNoTracking()
                .Where(e =>
                    e.SeasonId == currentSeason.Id &&
                    e.Player != null &&
                    ids.Contains(e.Player.NhlPlayerId))
                .Select(e => new PlayerOwnershipRowDto
                {
                    NhlPlayerId = e.Player!.NhlPlayerId,
                    FantasyTeamId = e.FantasyTeamId,
                    FantasyTeamName = e.FantasyTeam!.Name,
                    RosterStatus = e.RosterStatus.ToString()
                })
                .ToListAsync(ct);
        }

        private async Task<Season?> ResolveSeasonAsync(int? seasonId)
        {
            if (seasonId.HasValue)
            {
                return await _dbContext.Seasons
                    .AsNoTracking()
                    .FirstOrDefaultAsync(s => s.Id == seasonId.Value);
            }

            // Explicitly target SeasonCodes.Current rather than relying on
            // "latest StartDate". The draft-seeding step creates future
            // seasons (2027-2028) whose StartDate is later than the
            // current season's, so the "latest StartDate" heuristic would
            // silently return one of those.
            return await Data.SeasonQueries.GetCurrentSeasonAsync(
                _dbContext);
        }

        private static bool TryParseRosterStatus(string? value, out RosterStatus status)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                status = RosterStatus.Active;
                return true;
            }

            return Enum.TryParse(value, ignoreCase: true, out status)
                && Enum.IsDefined(status);
        }

        /// <summary>
        /// Called by every mutation method after SaveChangesAsync.
        /// Signals the scheduler to recompute team totals, and drops
        /// the cached read responses that are now stale. Because any
        /// roster change can affect standings (the player might have
        /// played today), we always invalidate both prefixes.
        /// </summary>
        private void OnRosterChanged()
        {
            _jobs.RequestRecompute();
            _cache.Invalidate("roster:");
            _cache.Invalidate("standings:");
            _cache.Invalidate("player-detail:");
            _cache.Invalidate("player-career:");
            _cache.Invalidate("top-scorers:");

            // Ownership changes on any roster mutation, so the
            // "ownership:" cache must be dropped at the same time.
            _cache.Invalidate("ownership:");
        }

        private static RosterActionResultDto Failure(string message)
        {
            return new RosterActionResultDto
            {
                Success = false,
                Message = message,
                Entry = null
            };
        }

        private static string PlayerName(Player player)
        {
            return $"{player.FirstName} {player.LastName}".Trim();
        }

        private static RosterEntryDto ToRosterEntryDto(
      RosterEntry entry,
      SeasonStatLineDto? twoSeasonsAgo = null,
      SeasonStatLineDto? lastSeason = null,
      SeasonStatLineDto? currentSeason = null,
      PlayerContractLineDto? currentContract = null,
      PlayerContractLineDto? secondContract = null,
      int? yesterdayFantasyPoints = null,
      int? todayFantasyPoints = null)
        {
            return new RosterEntryDto
            {
                Id = entry.Id,
                FantasyTeamId = entry.FantasyTeamId,
                PlayerId = entry.PlayerId,
                NhlPlayerId = entry.Player?.NhlPlayerId ?? 0,
                FirstName = entry.Player?.FirstName ?? string.Empty,
                LastName = entry.Player?.LastName ?? string.Empty,
                Position = entry.Player?.Position ?? string.Empty,
                Age = CalculatePlayerAge(entry.Player?.BirthDate),
                NhlTeamAbbreviation = entry.Player?.NhlTeam?.Abbreviation ?? string.Empty,
                RosterStatus = entry.RosterStatus.ToString(),
                RosterSlot = entry.RosterSlot,
                FantasySalary = entry.FantasySalary,
                HeadshotUrl = entry.Player?.HeadshotUrl,

                // Roster location from Player: NhlRoster / AhlRoster /
                // Injured / NotOnActiveRoster, or null when the
                // roster-status feature has never run for this player.
                // The lineup rows use it to tint the row background.
                RosterLocation = entry.Player?.RosterLocation?.ToString(),

                // Injury fields. Copied straight from Player so the card
                // and the future injuries page can render without a
                // second query.
                IsInjured = entry.Player?.IsInjured ?? false,
                InjuryStatus = entry.Player?.InjuryStatus,
                InjuryKind = entry.Player?.InjuryKind.ToString() ?? "None",
                InjuryShortDescription = entry.Player?.InjuryShortDescription,
                InjuryLongDescription = entry.Player?.InjuryLongDescription,
                InjuryType = entry.Player?.InjuryType,
                InjuryDetail = entry.Player?.InjuryDetail,
                InjurySide = entry.Player?.InjurySide,
                InjuryReturnDate = entry.Player?.InjuryReturnDate,
                InjuryFantasyStatus = entry.Player?.InjuryFantasyStatus,

                TwoSeasonsAgo = twoSeasonsAgo,
                LastSeason = lastSeason,
                CurrentSeason = currentSeason,
                CurrentContract = currentContract,
                SecondContract = secondContract,

                YesterdayFantasyPoints = yesterdayFantasyPoints,
                TodayFantasyPoints = todayFantasyPoints
            };
        }

        /// <summary>
        /// Age in years from a birth date. Mirrors the calculation used
        /// by PlayerDetailService so the marketplace and the player
        /// page always agree. Null when no birth date is known.
        /// </summary>
        private static int? CalculatePlayerAge(DateOnly? birthDate)
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

        private static SeasonStatLineDto? ToSeasonStatLineDto(
Season? season,
CardStatLine? line,
PlayerSeasonStat? seasonStat = null)
        {
            // Bail out only when the stat line itself is missing.
            // The Season row is used purely for the human label; the
            // raw season code lives on the stat line, so a missing
            // Season row must not hide real stats.
            //
            // This matters for past seasons that predate league setup
            // and never got a Season row created: the archive still
            // has the numbers, and the card should show them with a
            // label derived from the raw code (e.g. "25-26").
            if (line == null)
            {
                return null;
            }

            var seasonCode = season?.NhlSeasonCode ?? line.Season;

            var label =
                season != null && !string.IsNullOrWhiteSpace(season.Name)
                    ? season.Name
                    : $"{seasonCode / 10000}-{seasonCode % 100:D2}";

            // Fantasy points: prefer the live-tracked PlayerSeasonStat
            // row when it exists (it accounts for hat tricks,
            // shutouts, wins and OTLs that we might not have from the
            // archive). Fall back to the archive's own counting stats
            // otherwise, using the same formula MarketplaceService
            // uses for historical seasons. That way FP still shows for
            // seasons whose PlayerSeasonStat rows were never
            // populated (typically the pre-current years).
            var hatTricks = seasonStat?.HatTricks ?? line.HatTricks;
            var shutouts = seasonStat?.Shutouts ?? line.Shutouts;

            // FP IS NHL-ONLY.
            //
            // Fantasy points are amassed only in the NHL by league
            // rule. A player who did not dress for a single NHL game
            // this season has no FP, no matter what he did in the
            // AHL / SHL / Liiga / etc.
            //
            // The stat columns (GP, G, A, PTS, W, L, OTL, SO, 3B)
            // may still carry the fallback-league numbers so the
            // manager can see how the player is doing elsewhere.
            // Only the FP column is blank.
            //
            // Three cases:
            //   1. A PlayerSeasonStat row exists. It is NHL by
            //      construction (the table has no league column), so
            //      we use its FP value directly. This covers every
            //      player who has dressed for at least one NHL game
            //      this season, including a live-tracked row with
            //      GP = 0 from an Active roster slot.
            //   2. No PlayerSeasonStat row, but the archive line is
            //      from the NHL. Compute FP from the counting stats,
            //      matching the historical-season formula used
            //      everywhere else.
            //   3. No PlayerSeasonStat row and the archive line is
            //      from a non-NHL league. FP is null. This is the
            //      fallback-display case: stats are shown, FP is
            //      blank.
            int? fantasyPoints;

            if (seasonStat != null)
            {
                fantasyPoints = seasonStat.FantasyPoints;
            }
            else if (string.Equals(
                         line.LeagueAbbreviation,
                         "NHL",
                         StringComparison.OrdinalIgnoreCase))
            {
                fantasyPoints =
                    line.Points +
                    hatTricks * 3 +
                    line.Wins * 2 +
                    line.OvertimeLosses +
                    shutouts * 3;
            }
            else
            {
                fantasyPoints = null;
            }

            return new SeasonStatLineDto
            {
                Label = label,
                NhlSeasonCode = seasonCode,
                LeagueAbbreviation = line.LeagueAbbreviation,
                TeamName = null,
                GameTypeId = 2,
                GamesPlayed = line.GamesPlayed,
                Goals = line.Goals,
                Assists = line.Assists,
                Points = line.Points,
                Wins = line.Wins,
                Losses = line.Losses,
                OvertimeLosses = line.OvertimeLosses,
                HatTricks = hatTricks,
                Shutouts = shutouts,
                FantasyPoints = fantasyPoints,

                TimeOnIce = line.TimeOnIce,
            };
        }

        private async Task<decimal> ResolveSalaryFromContractsAsync(
            int playerId,
            int nhlSeasonCode,
            CancellationToken ct = default)
        {
            var contracts = await _dbContext.PlayerContracts
                .Where(c => c.PlayerId == playerId)
                .ToListAsync(ct);

            return ResolveSalaryFromContracts(contracts, nhlSeasonCode);
        }

        private static decimal ResolveSalaryFromContracts(
          IReadOnlyList<PlayerContract> contracts,
          int nhlSeasonCode)
        {
            if (contracts.Count == 0)
            {
                return 0m;
            }

            if (contracts.Count == 1)
            {
                return contracts[0].EffectiveSalary;
            }

            var coveringContract = contracts.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            return coveringContract?.EffectiveSalary ?? 0m;
        }

        private static decimal ResolveSalaryForSeason(
      IReadOnlyList<PlayerContract> contracts,
      int nhlSeasonCode)
        {
            var covering = contracts.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            return covering?.EffectiveSalary ?? 0m;
        }

        private static int AddSeasons(int seasonCode, int count)
        {
            var startYear = (seasonCode / 10000) + count;
            return (startYear * 10000) + (startYear + 1);
        }

        private static string ShortSeasonLabel(int seasonCode)
        {
            var startYear = seasonCode / 10000;
            var endYear = seasonCode % 100;
            return $"{startYear % 100:D2}-{endYear:D2}";
        }

        /// <summary>
        /// Parses an "MM:SS" time-on-ice string into total seconds.
        /// Returns -1 when the value is null, empty, or unparsable,
        /// so callers can distinguish "no value" from "0:00".
        /// </summary>
        private static int ParseToiSeconds(string? toi)
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
        /// Formats total seconds as an "MM:SS" time-on-ice string.
        /// Always pads the seconds component (e.g. "18:05") so the
        /// frontend can render the value raw.
        /// </summary>
        private static string FormatToiSeconds(int totalSeconds)
        {
            var minutes = totalSeconds / 60;
            var seconds = totalSeconds % 60;
            return $"{minutes}:{seconds:D2}";
        }

        private static (PlayerContractLineDto? Current, PlayerContractLineDto? Second)
            ResolveContractLines(
                IReadOnlyList<PlayerContract> contracts,
                int nhlSeasonCode)
        {
            var ordered = contracts
                .OrderBy(c => c.StartSeason)
                .ToList();

            if (ordered.Count == 0)
            {
                return (null, null);
            }

            var current = ordered.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            if (current == null && ordered.Count == 1)
            {
                current = ordered[0];
            }

            var currentEnd = current?.EndSeason ?? nhlSeasonCode;

            var second = ordered
                .Where(c => c.StartSeason > currentEnd)
                .OrderBy(c => c.StartSeason)
                .FirstOrDefault();

            return (
                current == null ? null : ToContractLineDto(current, nhlSeasonCode),
                second == null ? null : ToContractLineDto(second, nhlSeasonCode));
        }

        private static PlayerContractLineDto ToContractLineDto(
      PlayerContract contract,
      int nhlSeasonCode)
        {
            var seasonYear = nhlSeasonCode / 10000;
            var startYear = contract.StartSeason / 10000;
            var endYear = contract.EndSeason / 10000;

            var firstYear = Math.Max(seasonYear, startYear);
            var yearsRemaining = Math.Max(1, endYear - firstYear + 1);

            return new PlayerContractLineDto
            {
                Salary = contract.EffectiveSalary,
                YearsRemaining = yearsRemaining,
                StartSeason = contract.StartSeason,
                EndSeason = contract.EndSeason
            };
        }

        // =================================================================
        // Swap / shape validation helpers
        // =================================================================

        private sealed class SwapValidationResult
        {
            public RosterEntry? EntryA { get; set; }
            public RosterEntry? EntryB { get; set; }
            public Season? Season { get; set; }
            public RosterActionResultDto? Failure { get; set; }
        }

        private async Task<SwapValidationResult> ValidateSwapAsync(
            SwapRosterStatusRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return new SwapValidationResult
                {
                    Failure = Failure(
                        "Season not found. Run POST /api/League/setup first.")
                };
            }

            if (request.PlayerAId == request.PlayerBId)
            {
                return new SwapValidationResult
                {
                    Failure = Failure(
                        "PlayerAId and PlayerBId must be different.")
                };
            }

            var entryA = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .FirstOrDefaultAsync(e =>
                    e.SeasonId == season.Id &&
                    e.FantasyTeamId == request.FantasyTeamId &&
                    e.PlayerId == request.PlayerAId);

            var entryB = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .FirstOrDefaultAsync(e =>
                    e.SeasonId == season.Id &&
                    e.FantasyTeamId == request.FantasyTeamId &&
                    e.PlayerId == request.PlayerBId);

            if (entryA == null)
            {
                return new SwapValidationResult
                {
                    Failure = Failure(
                        $"Player {request.PlayerAId} is not on " +
                        $"team {request.FantasyTeamId} for {season.Name}.")
                };
            }

            if (entryB == null)
            {
                return new SwapValidationResult
                {
                    Failure = Failure(
                        $"Player {request.PlayerBId} is not on " +
                        $"team {request.FantasyTeamId} for {season.Name}.")
                };
            }

            var groupA = PositionGroupHelper.Classify(entryA.Player!.Position);
            var groupB = PositionGroupHelper.Classify(entryB.Player!.Position);

            if (groupA == PositionGroup.Unknown ||
                groupB == PositionGroup.Unknown)
            {
                return new SwapValidationResult
                {
                    Failure = Failure(
                        "Cannot swap: at least one player has an " +
                        "unclassifiable position. " +
                        $"A='{entryA.Player.Position}', " +
                        $"B='{entryB.Player.Position}'.")
                };
            }

            if (groupA != groupB)
            {
                return new SwapValidationResult
                {
                    Failure = Failure(
                        "Cannot swap across position groups. " +
                        $"{PlayerName(entryA.Player)} is {groupA}, " +
                        $"{PlayerName(entryB.Player)} is {groupB}.")
                };
            }

            var shapeFailure = await CheckShapeAfterAsync(
                request.FantasyTeamId,
                season.Id,
                new[]
                {
                    (entryA.Id, entryB.RosterStatus),
                    (entryB.Id, entryA.RosterStatus)
                });

            if (shapeFailure != null)
            {
                return new SwapValidationResult { Failure = shapeFailure };
            }

            return new SwapValidationResult
            {
                EntryA = entryA,
                EntryB = entryB,
                Season = season
            };
        }

        /// <summary>
        /// Simulates the given pending changes on top of the current
        /// roster and refuses the operation when the resulting shape is
        /// not exactly 12/6/1 active + 4/2/1 bench + 3 prospects.
        /// </summary>
        private async Task<RosterActionResultDto?> CheckShapeAfterAsync(
            int fantasyTeamId,
            int seasonId,
            IEnumerable<(int EntryId, RosterStatus NewStatus)> changes)
        {
            var changeMap = changes.ToDictionary(
                c => c.EntryId, c => c.NewStatus);

            var entries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Where(e =>
                    e.FantasyTeamId == fantasyTeamId &&
                    e.SeasonId == seasonId)
                .ToListAsync();

            int activeF = 0, activeD = 0, activeG = 0;
            int benchF = 0, benchD = 0, benchG = 0;
            int prospects = 0;

            foreach (var entry in entries)
            {
                var status = changeMap.TryGetValue(entry.Id, out var ns)
                    ? ns
                    : entry.RosterStatus;

                if (status == RosterStatus.Prospect)
                {
                    prospects++;
                    continue;
                }

                var group = PositionGroupHelper.Classify(
                    entry.Player!.Position);

                if (group == PositionGroup.Unknown)
                {
                    return Failure(
                        $"Cannot classify position " +
                        $"'{entry.Player.Position}' for " +
                        $"{PlayerName(entry.Player)}.");
                }

                if (status == RosterStatus.Active)
                {
                    switch (group)
                    {
                        case PositionGroup.Forward: activeF++; break;
                        case PositionGroup.Defense: activeD++; break;
                        case PositionGroup.Goalie: activeG++; break;
                    }
                }
                else if (status == RosterStatus.Bench)
                {
                    switch (group)
                    {
                        case PositionGroup.Forward: benchF++; break;
                        case PositionGroup.Defense: benchD++; break;
                        case PositionGroup.Goalie: benchG++; break;
                    }
                }
            }

            if (activeF != 12 || activeD != 6 || activeG != 1 ||
                benchF != 4 || benchD != 2 || benchG != 1 ||
                prospects != 3)
            {
                return Failure(
                    "Operation refused: the resulting roster shape would be " +
                    $"{activeF}F/{activeD}D/{activeG}G active, " +
                    $"{benchF}F/{benchD}D/{benchG}G bench, " +
                    $"{prospects} prospect(s). " +
                    "Required: 12F/6D/1G active, 4F/2D/1G bench, 3 prospects.");
            }

            return null;
        }

        /// <summary>
        /// Truncates the caller-supplied instant to day precision
        /// (00:00:00 UTC of the same calendar day) so the scoring
        /// recompute can compare it directly to PlayerGameLog.GameDate
        /// without needing a per-game start time.
        ///
        /// Used only by mutations that accept an explicit EffectiveAt
        /// from the caller (trade, swap, set-status, history edit).
        /// The implicit mutations (assign, release, release-all) use
        /// NextUtcDayStart instead, so a mid-day action can never
        /// retroactively re-attribute a game that already started.
        /// </summary>
        private static DateTime NormalizeEffectiveAt(DateTime raw)
        {
            if (raw.Kind == DateTimeKind.Local)
            {
                raw = raw.ToUniversalTime();
            }
            else if (raw.Kind == DateTimeKind.Unspecified)
            {
                raw = DateTime.SpecifyKind(raw, DateTimeKind.Utc);
            }

            return new DateTime(
                raw.Year, raw.Month, raw.Day,
                0, 0, 0, DateTimeKind.Utc);
        }

        /// <summary>
        /// Returns 00:00 UTC on the day AFTER the current UTC day.
        ///
        /// Used by roster mutations that have no caller-supplied
        /// effective instant: assign, release, release-all.
        ///
        /// WHY TOMORROW, NOT TODAY.
        ///
        /// The scoring recompute credits a game to a fantasy team iff
        /// the last RosterStatusHistory row for the player with
        /// EffectiveAt &lt;= game-day 00:00 UTC has RosterStatus
        /// Active. If these mutations wrote "today 00:00 UTC", a game
        /// that started earlier the same ET day (a matinee, an early
        /// West Coast game) would be retroactively re-attributed:
        /// releasing a player at 14:00 ET would strip a game that
        /// started at 13:00 ET, even though the player was still on
        /// the team when the puck dropped.
        ///
        /// Tomorrow's day boundary sits past every game that could
        /// possibly have already started, so the mutation can never
        /// reach backwards. The cost is that the change is
        /// effective from tomorrow, not from "now": today's games
        /// still belong to the old state, which is exactly what the
        /// league wants and is consistent with the day-granularity
        /// used by PlayerGameLog.GameDate and the recompute.
        ///
        /// The trade / swap / set-status endpoints are NOT affected:
        /// those accept an explicit EffectiveAt from the caller, who
        /// chooses the day boundary deliberately (typically the 1st
        /// of a month, per league rules).
        /// </summary>
        private static DateTime NextUtcDayStart()
        {
            var tomorrow = DateTime.UtcNow.Date.AddDays(1);
            return DateTime.SpecifyKind(tomorrow, DateTimeKind.Utc);
        }

        /// <summary>
        /// Deletes every active marketplace object that references
        /// any of the given players, because a player who just
        /// changed teams can no longer be offered by his old team
        /// (as a TradeOffer offering player) nor used as a
        /// responding pick by a former manager (as a
        /// TradeOfferResponse responding player).
        ///
        /// Two passes:
        ///
        ///   1. Every ACTIVE TradeOffer that lists one of these
        ///      players as an OfferingPlayerId on any of its slots.
        ///      Deleting the offer cascades to its slots, its
        ///      responses, its response slots, and its per-user
        ///      "seen" markers (see AppDbContext for the cascade
        ///      rules). This is the correct unit of deletion: an
        ///      offer that still advertises a player his old team
        ///      no longer owns is invalid from its first slot
        ///      onward.
        ///
        ///   2. Every PENDING or ACCEPTED TradeOfferResponse whose
        ///      slot uses one of these players as a
        ///      RespondingPlayerId, restricted to offers that are
        ///      NOT being deleted in pass 1 (their responses
        ///      cascade, so no explicit delete is needed). The
        ///      parent TradeOffer is left untouched — it is
        ///      another manager's announcement and remains valid
        ///      if it doesn't reference any of these players on
        ///      its own slots.
        ///
        /// Closed, Cancelled and Rejected responses, and non-Active
        /// offers, are not touched: they are already invisible to
        /// every user (each panel filters them out) and deleting
        /// them would erase audit rows for no benefit.
        ///
        /// Does NOT call SaveChangesAsync. The caller must save in
        /// the same transaction as the roster mutation, so the
        /// marketplace is always consistent with who currently
        /// owns whom.
        /// </summary>
        private async Task<(int OffersDeleted, int ResponsesDeleted)>
            DeleteMarketplaceObjectsInvolvingPlayersAsync(
                IReadOnlyCollection<int> playerIds)
        {
            if (playerIds.Count == 0)
            {
                return (0, 0);
            }

            // Pass 1: active offers that advertise any of these
            // players on the creator's side.
            var offerIdsToDelete = await _dbContext.TradeOfferSlots
                .AsNoTracking()
                .Where(s =>
                    s.OfferingPlayerId.HasValue &&
                    playerIds.Contains(s.OfferingPlayerId.Value) &&
                    s.TradeOffer.Status == TradeOfferStatus.Active)
                .Select(s => s.TradeOfferId)
                .Distinct()
                .ToListAsync();

            if (offerIdsToDelete.Count > 0)
            {
                var offersToDelete = await _dbContext.TradeOffers
                    .Where(o => offerIdsToDelete.Contains(o.Id))
                    .ToListAsync();

                _dbContext.TradeOffers.RemoveRange(offersToDelete);
            }

            // Pass 2: pending or accepted responses that used any
            // of these players on the responder's side, restricted
            // to offers we are NOT already deleting.
            //
            // RespondingPlayerId is nullable now (unbalanced direct
            // offers can leave it null on a slot the responder did
            // not fill), so the Contains has to run against the
            // unwrapped int. EF translates the HasValue + .Value
            // pair into a plain "IN (...) AND IS NOT NULL" in SQL.
            var responseIdsToDelete = await _dbContext
                .TradeOfferResponseSlots
                .AsNoTracking()
                .Where(s =>
                    s.RespondingPlayerId.HasValue &&
                    playerIds.Contains(s.RespondingPlayerId.Value) &&
                    (s.TradeOfferResponse.Status ==
                        TradeOfferResponseStatus.Pending ||
                     s.TradeOfferResponse.Status ==
                        TradeOfferResponseStatus.Accepted) &&
                    !offerIdsToDelete.Contains(
                        s.TradeOfferResponse.TradeOfferId))
                .Select(s => s.TradeOfferResponseId)
                .Distinct()
                .ToListAsync();

            if (responseIdsToDelete.Count > 0)
            {
                var responsesToDelete = await _dbContext
                    .TradeOfferResponses
                    .Where(r => responseIdsToDelete.Contains(r.Id))
                    .ToListAsync();

                _dbContext.TradeOfferResponses.RemoveRange(
                    responsesToDelete);
            }

            return (
                offerIdsToDelete.Count,
                responseIdsToDelete.Count);
        }

        /// <summary>
        /// Builds the trailing clause the roster operation appends
        /// to its success message when the marketplace cleanup
        /// deleted anything. Returns an empty string when nothing
        /// was deleted, so the caller can just concatenate
        /// unconditionally.
        /// </summary>
        private static string BuildMarketplaceCleanupSuffix(
            int offersDeleted,
            int responsesDeleted)
        {
            if (offersDeleted == 0 && responsesDeleted == 0)
            {
                return string.Empty;
            }

            var parts = new List<string>();

            if (offersDeleted > 0)
            {
                parts.Add($"{offersDeleted} offer(s)");
            }

            if (responsesDeleted > 0)
            {
                parts.Add($"{responsesDeleted} response(s)");
            }

            return
                " Marketplace: removed " +
                string.Join(" and ", parts) +
                " involving him.";
        }

        private void AddHistoryRow(
  int playerId,
  int fantasyTeamId,
  int seasonId,
  RosterStatus status,
  DateTime effectiveAt,
  string? note,
  TradeHistory? tradeHistory = null,
  StatusChangeHistory? statusChangeHistory = null)
        {
            _dbContext.RosterStatusHistories.Add(new RosterStatusHistory
            {
                PlayerId = playerId,
                FantasyTeamId = fantasyTeamId,
                SeasonId = seasonId,
                RosterStatus = status,
                EffectiveAt = effectiveAt,
                CreatedAt = DateTime.UtcNow,
                Note = note,

                // Only FinalizeTradeAsync passes a TradeHistory here.
                // Only FinalizeStatusChangeAsync passes a
                // StatusChangeHistory here. Every other caller
                // (assign, swap, set-status, release, manual edits,
                // backfill) leaves both null, so its rows are never
                // touched by trade or status change date changes.
                TradeHistory = tradeHistory,
                StatusChangeHistory = statusChangeHistory,
            });
        }

        /// <summary>
        /// Returns per-game stats for every player on the given
        /// fantasy team who dressed for an NHL game on the given
        /// calendar date (ET).
        ///
        /// This reads PlayerGameLog instead of the NHL boxscore
        /// endpoint, which means:
        ///   - Zero calls to the NHL API.
        ///   - Instant response (one indexed DB query).
        ///   - Correct TOI, because PlayerGameLog.TimeOnIce is
        ///     populated by the live refresh and post-game write.
        ///
        /// Only players who actually appeared in a game are
        /// returned. A player who was on the roster but did not
        /// dress (healthy scratch, AHL assignment, etc.) has no
        /// PlayerGameLog row for that date and is therefore omitted,
        /// which matches the desired UX for the "Hier" table.
        ///
        /// Used by ClassementPage's "Hier" section.
        /// </summary>
        public async Task<List<RosterPlayerGameStatDto>>
            GetRosterGameStatsForDateAsync(
                int fantasyTeamId,
                DateOnly date,
                CancellationToken ct = default)
        {
            // Resolve the current season by its season code, not by
            // "latest StartDate". The draft-seeding step creates
            // future seasons (2027-2028) whose StartDate is later
            // than the current season's, so "latest StartDate" would
            // silently return one of those, the roster lookup below
            // would find zero entries, and the endpoint would return
            // an empty list — which is the "Hier" table showing
            // "Aucun de vos joueurs n'a joué hier" while games were
            // actually played.
            var season = await Data.SeasonQueries
                .GetCurrentSeasonAsync(_dbContext, ct);

            if (season == null)
            {
                return new List<RosterPlayerGameStatDto>();
            }

            // Roster player ids for the requested team in that season.
            var rosterPlayerIds = await _dbContext.RosterEntries
                .AsNoTracking()
                .Where(e =>
                    e.FantasyTeamId == fantasyTeamId &&
                    e.SeasonId == season.Id)
                .Select(e => e.PlayerId)
                .ToListAsync(ct);

            if (rosterPlayerIds.Count == 0)
            {
                return new List<RosterPlayerGameStatDto>();
            }

            // One query, all matching game log rows for the date.
            // NhlPlayerId is read off the Player navigation; EF
            // auto-joins the parent table inside a projection.
            var rows = await _dbContext.PlayerGameLogs
                .AsNoTracking()
                .Where(g =>
                    g.SeasonId == season.Id &&
                    g.GameDate == date &&
                    rosterPlayerIds.Contains(g.PlayerId))
                .Select(g => new RosterPlayerGameStatDto
                {
                    PlayerId = g.PlayerId,
                    NhlPlayerId = g.Player.NhlPlayerId,
                    GameId = g.NhlGameId,
                    Goals = g.Goals,
                    Assists = g.Assists,
                    Points = g.Points,
                    PlusMinus = g.PlusMinus,
                    TimeOnIce = g.TimeOnIce,
                    Shots = g.Shots,
                    FantasyPoints = g.FantasyPoints
                })
                .ToListAsync(ct);

            return rows;
        }

        // =================================================================
        // Commissioner trade execution
        //
        // One endpoint covers the entire "Créer un échange" flow: the
        // admin sends the full trade shape (players sent by each side,
        // picks sent by each side, effective date, optional note). We
        // validate, apply, and persist an immutable TradeHistory row
        // in one transaction.
        //
        // Validation rules enforced here:
        //   1. Both teams exist and are different.
        //   2. Every listed player is currently on the team that is
        //      supposed to be sending him.
        //   3. Every listed pick is currently owned by the sending team.
        //   4. Position groups balance: the number of forwards sent by
        //      A equals the number sent by B, same for defensemen and
        //      goalies. Enforces the league's "equal number of players,
        //      same position" trade rule and keeps both rosters at the
        //      12F/6D/1G + 4F/2D/1G + 3 prospects shape after the swap.
        //   5. Both teams' shapes are valid after the simulated trade.
        //
        // On success:
        //   - Every transferred player's RosterEntry.FantasyTeamId is
        //     rewritten.
        //   - Every transferred player gets two RosterStatusHistory rows
        //     at the effective instant (out-row on the old team, in-row
        //     on the new team), matching the convention used by every
        //     other roster mutation.
        //   - Every transferred DraftPick.CurrentOwnerFantasyTeamId is
        //     rewritten. OriginalOwnerFantasyTeamId is untouched.
        //   - All marketplace offers / responses that referenced any
        //     moved player are deleted (same cleanup as MovePlayerAsync).
        //   - A TradeHistory row is written with the full JSON snapshot.
        //
        // The whole thing is a single SaveChangesAsync, so partial
        // application is impossible.
        // =================================================================

        public async Task<FinalizeTradeResultDto> FinalizeTradeAsync(
      FinalizeTradeRequest request,
      CancellationToken ct = default)
        {
            if (request.TeamAId <= 0 || request.TeamBId <= 0)
            {
                return TradeFailure("TeamAId and TeamBId are required.");
            }

            if (request.TeamAId == request.TeamBId)
            {
                return TradeFailure("TeamAId and TeamBId must be different.");
            }

            if (request.EffectiveAt == default)
            {
                return TradeFailure("EffectiveAt is required.");
            }

            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
                _dbContext, ct);

            if (season == null)
            {
                return TradeFailure(
                    "No current season. Run POST /api/League/setup first.");
            }

            var teamA = await _dbContext.FantasyTeams
                .FirstOrDefaultAsync(t => t.Id == request.TeamAId, ct);

            var teamB = await _dbContext.FantasyTeams
                .FirstOrDefaultAsync(t => t.Id == request.TeamBId, ct);

            if (teamA == null)
            {
                return TradeFailure($"Fantasy team {request.TeamAId} not found.");
            }

            if (teamB == null)
            {
                return TradeFailure($"Fantasy team {request.TeamBId} not found.");
            }

            // ---- Duplicate detection -----------------------------------

            var aPlayerIds = request.TeamASendingPlayers
                .Select(p => p.PlayerId)
                .ToList();

            if (aPlayerIds.Distinct().Count() != aPlayerIds.Count)
            {
                return TradeFailure(
                    "Duplicate players in Team A's sent list.");
            }

            var bPlayerIds = request.TeamBSendingPlayers
                .Select(p => p.PlayerId)
                .ToList();

            if (bPlayerIds.Distinct().Count() != bPlayerIds.Count)
            {
                return TradeFailure(
                    "Duplicate players in Team B's sent list.");
            }

            // ---- Load players in the trade ------------------------------

            var allPlayerIds = aPlayerIds
                .Concat(bPlayerIds)
                .Distinct()
                .ToList();

            if (allPlayerIds.Count == 0 &&
                request.TeamASendingDraftPickIds.Count == 0 &&
                request.TeamBSendingDraftPickIds.Count == 0)
            {
                return TradeFailure(
                    "The trade must contain at least one player or draft pick.");
            }

            var entries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                    .ThenInclude(p => p.NhlTeam)
                .Where(e =>
                    e.SeasonId == season.Id &&
                    allPlayerIds.Contains(e.PlayerId))
                .ToListAsync(ct);

            var entriesByPlayerId = entries.ToDictionary(e => e.PlayerId);

            foreach (var req in request.TeamASendingPlayers)
            {
                if (!entriesByPlayerId.TryGetValue(req.PlayerId, out var e) ||
                    e.FantasyTeamId != request.TeamAId)
                {
                    return TradeFailure(
                        $"Player {req.PlayerId} is not currently on {teamA.Name}.");
                }
            }

            foreach (var req in request.TeamBSendingPlayers)
            {
                if (!entriesByPlayerId.TryGetValue(req.PlayerId, out var e) ||
                    e.FantasyTeamId != request.TeamBId)
                {
                    return TradeFailure(
                        $"Player {req.PlayerId} is not currently on {teamB.Name}.");
                }
            }

            // ---- Parse and validate status overrides -------------------

            var afterStatusByPlayerId =
                new Dictionary<int, RosterStatus>();

            foreach (var req in request.TeamASendingPlayers
                .Concat(request.TeamBSendingPlayers))
            {
                if (string.IsNullOrWhiteSpace(req.NewStatus))
                {
                    continue;
                }

                if (!TryParseLiveStatus(req.NewStatus, out var parsed))
                {
                    return TradeFailure(
                        $"Invalid new status '{req.NewStatus}' for " +
                        $"player {req.PlayerId}. " +
                        "Use Active, Bench or Prospect.");
                }

                afterStatusByPlayerId[req.PlayerId] = parsed;
            }

            // ---- Position balance --------------------------------------

            int CountGroup(
                IEnumerable<TradePlayerRequest> reqs,
                PositionGroup g) =>
                reqs.Count(r =>
                    entriesByPlayerId.TryGetValue(
                        r.PlayerId, out var e) &&
                    PositionGroupHelper.Classify(e.Player.Position) == g);

            if (CountGroup(request.TeamASendingPlayers, PositionGroup.Forward) !=
                CountGroup(request.TeamBSendingPlayers, PositionGroup.Forward))
            {
                return TradeFailure(
                    "Position mismatch: the number of forwards sent by " +
                    "each team must match.");
            }

            if (CountGroup(request.TeamASendingPlayers, PositionGroup.Defense) !=
                CountGroup(request.TeamBSendingPlayers, PositionGroup.Defense))
            {
                return TradeFailure(
                    "Position mismatch: the number of defensemen sent by " +
                    "each team must match.");
            }

            if (CountGroup(request.TeamASendingPlayers, PositionGroup.Goalie) !=
                CountGroup(request.TeamBSendingPlayers, PositionGroup.Goalie))
            {
                return TradeFailure(
                    "Position mismatch: the number of goalies sent by " +
                    "each team must match.");
            }

            // ---- Shape validation --------------------------------------
            //
            // DISABLED (per league request): the commissioner wants to be
            // able to complete trades that temporarily break the shape
            // 12F/6D/1G active + 4F/2D/1G bench + 3 prospects, and then
            // fix each team's statuses manually afterward.
            //
            // Position balance is still enforced above (equal number of
            // F/D/G on each side), so a trade cannot unbalance the two
            // teams' aggregate position mix. Only the Active / Bench /
            // Prospect allocation can now be temporarily off, and only
            // until the commissioner corrects it through the "Gestion
            // des joueurs" edit form (which does NOT enforce the shape
            // check — see UpdateEntryAsync).
            //
            // The AdminPage's trade form displays the projected shape
            // under each team with a warning when it will be off, so
            // the commissioner can see the effect before confirming.

            // ---- Load picks in the trade -------------------------------

            var allPickIds = request.TeamASendingDraftPickIds
                .Concat(request.TeamBSendingDraftPickIds)
                .Distinct()
                .ToList();

            var picks = await _dbContext.DraftPicks
                .Include(p => p.Draft)
                    .ThenInclude(d => d.Season)
                .Include(p => p.OriginalOwnerFantasyTeam)
                .Where(p => allPickIds.Contains(p.Id))
                .ToListAsync(ct);

            var picksById = picks.ToDictionary(p => p.Id);

            foreach (var id in request.TeamASendingDraftPickIds)
            {
                if (!picksById.TryGetValue(id, out var p) ||
                    p.CurrentOwnerFantasyTeamId != request.TeamAId)
                {
                    return TradeFailure(
                        $"Draft pick {id} is not currently owned by {teamA.Name}.");
                }
            }

            foreach (var id in request.TeamBSendingDraftPickIds)
            {
                if (!picksById.TryGetValue(id, out var p) ||
                    p.CurrentOwnerFantasyTeamId != request.TeamBId)
                {
                    return TradeFailure(
                        $"Draft pick {id} is not currently owned by {teamB.Name}.");
                }
            }

            // ---- Load contracts for the snapshot -----------------------

            var contracts = await _dbContext.PlayerContracts
                .AsNoTracking()
                .Where(c => allPlayerIds.Contains(c.PlayerId))
                .ToListAsync(ct);

            var contractsByPlayerId = contracts
                .GroupBy(c => c.PlayerId)
                .ToDictionary(g => g.Key, g => g.ToList());

            // ---- Build the snapshot ------------------------------------

            var teamAPlayers = request.TeamASendingPlayers
                .Select(req => BuildTradePlayerSideDto(
                    entriesByPlayerId[req.PlayerId],
                    contractsByPlayerId.GetValueOrDefault(req.PlayerId),
                    season.NhlSeasonCode,
                    afterStatusByPlayerId.TryGetValue(
                        req.PlayerId, out var nsA)
                        ? nsA
                        : entriesByPlayerId[req.PlayerId].RosterStatus))
                .ToList();

            var teamBPlayers = request.TeamBSendingPlayers
                .Select(req => BuildTradePlayerSideDto(
                    entriesByPlayerId[req.PlayerId],
                    contractsByPlayerId.GetValueOrDefault(req.PlayerId),
                    season.NhlSeasonCode,
                    afterStatusByPlayerId.TryGetValue(
                        req.PlayerId, out var nsB)
                        ? nsB
                        : entriesByPlayerId[req.PlayerId].RosterStatus))
                .ToList();

            var teamAPicks = request.TeamASendingDraftPickIds
                .Select(id => BuildTradePickSideDto(picksById[id]))
                .ToList();

            var teamBPicks = request.TeamBSendingDraftPickIds
                .Select(id => BuildTradePickSideDto(picksById[id]))
                .ToList();

            var effectiveAt = NormalizeEffectiveAt(request.EffectiveAt);
            var trimmedNote = string.IsNullOrWhiteSpace(request.Note)
                ? null
                : request.Note!.Trim();

            if (trimmedNote != null && trimmedNote.Length > 500)
            {
                trimmedNote = trimmedNote.Substring(0, 500);
            }

            var snapshot = new TradeSnapshotPayload
            {
                TeamAId = teamA.Id,
                TeamAName = teamA.Name,
                TeamBId = teamB.Id,
                TeamBName = teamB.Name,
                EffectiveAt = effectiveAt,
                TeamASentPlayers = teamAPlayers,
                TeamBSentPlayers = teamBPlayers,
                TeamASentPicks = teamAPicks,
                TeamBSentPicks = teamBPicks,
            };

            // ---- Apply -------------------------------------------------

            var historyNote = trimmedNote ?? "Trade";

            // Build the TradeHistory FIRST so the player history rows
            // can reference it via the nav property. EF then orders
            // the inserts correctly inside one transaction: TradeHistory
            // first (with its generated Id), then the dependent
            // RosterStatusHistory rows with the FK already set.
            var history = new TradeHistory
            {
                SeasonId = season.Id,
                TeamAId = teamA.Id,
                TeamBId = teamB.Id,
                EffectiveAt = effectiveAt,
                ConfirmedAt = DateTime.UtcNow,
                Note = trimmedNote,
                SnapshotJson = System.Text.Json.JsonSerializer.Serialize(
                    snapshot),
            };

            foreach (var req in request.TeamASendingPlayers)
            {
                var e = entriesByPlayerId[req.PlayerId];

                var beforeStatus = e.RosterStatus;

                var afterStatus = afterStatusByPlayerId.TryGetValue(
                    req.PlayerId, out var nsA)
                    ? nsA
                    : beforeStatus;

                AddHistoryRow(
                    req.PlayerId, request.TeamAId, season.Id,
                    beforeStatus, effectiveAt,
                    $"Trade to {teamB.Name}: {historyNote}",
                    history);

                AddHistoryRow(
                    req.PlayerId, request.TeamBId, season.Id,
                    afterStatus, effectiveAt,
                    $"Trade from {teamA.Name}: {historyNote}",
                    history);

                e.FantasyTeamId = request.TeamBId;
                e.RosterStatus = afterStatus;
            }

            foreach (var req in request.TeamBSendingPlayers)
            {
                var e = entriesByPlayerId[req.PlayerId];

                var beforeStatus = e.RosterStatus;

                var afterStatus = afterStatusByPlayerId.TryGetValue(
                    req.PlayerId, out var nsB)
                    ? nsB
                    : beforeStatus;

                AddHistoryRow(
                    req.PlayerId, request.TeamBId, season.Id,
                    beforeStatus, effectiveAt,
                    $"Trade to {teamA.Name}: {historyNote}",
                    history);

                AddHistoryRow(
                    req.PlayerId, request.TeamAId, season.Id,
                    afterStatus, effectiveAt,
                    $"Trade from {teamB.Name}: {historyNote}",
                    history);

                e.FantasyTeamId = request.TeamAId;
                e.RosterStatus = afterStatus;
            }

            foreach (var id in request.TeamASendingDraftPickIds)
            {
                picksById[id].CurrentOwnerFantasyTeamId = request.TeamBId;
            }

            foreach (var id in request.TeamBSendingDraftPickIds)
            {
                picksById[id].CurrentOwnerFantasyTeamId = request.TeamAId;
            }

            // Marketplace cleanup: any active offer or pending response
            // referencing a moved player is now stale, because his old
            // team no longer owns him.
            if (allPlayerIds.Count > 0)
            {
                await DeleteMarketplaceObjectsInvolvingPlayersAsync(
                    allPlayerIds);
            }

            _dbContext.TradeHistories.Add(history);

            await _dbContext.SaveChangesAsync(ct);

            OnRosterChanged();

            return new FinalizeTradeResultDto
            {
                Success = true,
                Message =
                    $"Trade confirmed between {teamA.Name} and {teamB.Name}.",
                TradeHistory = BuildTradeHistoryDto(
                    history, season, teamA, teamB, snapshot),
            };
        }

        public async Task<List<TradeHistoryDto>> GetTradeHistoryAsync(
      int? seasonId,
      CancellationToken ct = default)
        {
            var query = _dbContext.TradeHistories
                .AsNoTracking()
                .Include(h => h.Season)
                .Include(h => h.TeamA)
                .Include(h => h.TeamB)
                .Include(h => h.DateChanges)
                .AsQueryable();

            if (seasonId.HasValue)
            {
                query = query.Where(h => h.SeasonId == seasonId.Value);
            }

            var rows = await query
                .OrderByDescending(h => h.ConfirmedAt)
                .ToListAsync(ct);

            var result = new List<TradeHistoryDto>();

            foreach (var row in rows)
            {
                TradeSnapshotPayload? payload;

                try
                {
                    payload = System.Text.Json.JsonSerializer
                        .Deserialize<TradeSnapshotPayload>(
                            row.SnapshotJson);
                }
                catch
                {
                    // A corrupt snapshot should not break the whole
                    // history. Skip the row; the audit trail is
                    // incomplete only for that one trade.
                    continue;
                }

                if (payload == null) continue;

                result.Add(BuildTradeHistoryDto(
                    row, row.Season, row.TeamA, row.TeamB, payload));
            }

            return result;
        }

        private async Task<string?> ValidateTradeShapeAsync(
     int teamAId,
     int teamBId,
     int seasonId,
     IReadOnlyList<int> teamASendingPlayerIds,
     IReadOnlyList<int> teamBSendingPlayerIds,
     IReadOnlyDictionary<int, RosterStatus> statusOverrides,
     CancellationToken ct)
        {
            var allEntries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                    .ThenInclude(p => p.NhlTeam)
                .Where(e =>
                    e.SeasonId == seasonId &&
                    (e.FantasyTeamId == teamAId || e.FantasyTeamId == teamBId))
                .ToListAsync(ct);

            var aSending = teamASendingPlayerIds.ToHashSet();
            var bSending = teamBSendingPlayerIds.ToHashSet();

            var teamAAfter = allEntries
                .Where(e =>
                    (e.FantasyTeamId == teamAId && !aSending.Contains(e.PlayerId)) ||
                    (e.FantasyTeamId == teamBId && bSending.Contains(e.PlayerId)))
                .ToList();

            var teamBAfter = allEntries
                .Where(e =>
                    (e.FantasyTeamId == teamBId && !bSending.Contains(e.PlayerId)) ||
                    (e.FantasyTeamId == teamAId && aSending.Contains(e.PlayerId)))
                .ToList();

            var teamAName = allEntries
                .Where(e => e.FantasyTeamId == teamAId)
                .Select(e => e.FantasyTeam?.Name)
                .FirstOrDefault() ?? $"Team {teamAId}";

            var teamBName = allEntries
                .Where(e => e.FantasyTeamId == teamBId)
                .Select(e => e.FantasyTeam?.Name)
                .FirstOrDefault() ?? $"Team {teamBId}";

            var fail = ValidateTeamShape(
                teamAAfter, statusOverrides, teamAName);
            if (fail != null) return fail;

            return ValidateTeamShape(
                teamBAfter, statusOverrides, teamBName);
        }

        private static string? ValidateTeamShape(
            List<RosterEntry> entries,
            IReadOnlyDictionary<int, RosterStatus> statusOverrides,
            string teamName)
        {
            int activeF = 0, activeD = 0, activeG = 0;
            int benchF = 0, benchD = 0, benchG = 0;
            int prospects = 0;

            foreach (var entry in entries)
            {
                // Arriving players who carry a status override use the
                // override; everyone else uses their current status.
                var status = statusOverrides.TryGetValue(
                    entry.PlayerId, out var ns)
                    ? ns
                    : entry.RosterStatus;

                var group = PositionGroupHelper.Classify(
                    entry.Player?.Position);

                if (group == PositionGroup.Unknown)
                {
                    return
                        $"{teamName}: unclassifiable position " +
                        $"'{entry.Player?.Position}' for " +
                        $"{entry.Player?.FirstName} {entry.Player?.LastName}.";
                }

                if (status == RosterStatus.Prospect)
                {
                    prospects++;
                    continue;
                }

                if (status == RosterStatus.Active)
                {
                    switch (group)
                    {
                        case PositionGroup.Forward: activeF++; break;
                        case PositionGroup.Defense: activeD++; break;
                        case PositionGroup.Goalie: activeG++; break;
                    }
                }
                else if (status == RosterStatus.Bench)
                {
                    switch (group)
                    {
                        case PositionGroup.Forward: benchF++; break;
                        case PositionGroup.Defense: benchD++; break;
                        case PositionGroup.Goalie: benchG++; break;
                    }
                }
            }

            if (activeF != 12 || activeD != 6 || activeG != 1 ||
                benchF != 4 || benchD != 2 || benchG != 1 ||
                prospects != 3)
            {
                return
                    $"{teamName} would end up with " +
                    $"{activeF}F/{activeD}D/{activeG}G active, " +
                    $"{benchF}F/{benchD}D/{benchG}G bench, " +
                    $"{prospects} prospect(s). " +
                    "Required: 12F/6D/1G active, 4F/2D/1G bench, 3 prospects.";
            }

            return null;
        }

        private static AdminTradePlayerSideDto BuildTradePlayerSideDto(
       RosterEntry entry,
       List<PlayerContract>? contracts,
       int nhlSeasonCode,
       RosterStatus newStatus)
        {
            var salary = 0m;
            var yearsRemaining = 0;

            if (contracts != null && contracts.Count > 0)
            {
                var covering = contracts.FirstOrDefault(c =>
                    c.StartSeason <= nhlSeasonCode &&
                    c.EndSeason >= nhlSeasonCode);

                if (covering != null)
                {
                    salary = covering.EffectiveSalary;

                    var seasonYear = nhlSeasonCode / 10000;
                    var startYear = covering.StartSeason / 10000;
                    var endYear = covering.EndSeason / 10000;
                    var firstYear = Math.Max(seasonYear, startYear);

                    yearsRemaining = Math.Max(
                        1, endYear - firstYear + 1);
                }
            }

            return new AdminTradePlayerSideDto
            {
                PlayerId = entry.PlayerId,
                NhlPlayerId = entry.Player?.NhlPlayerId ?? 0,
                FirstName = entry.Player?.FirstName ?? string.Empty,
                LastName = entry.Player?.LastName ?? string.Empty,
                Position = entry.Player?.Position ?? string.Empty,
                NhlTeamAbbreviation =
                    entry.Player?.NhlTeam?.Abbreviation ?? string.Empty,
                Salary = salary,
                YearsRemaining = yearsRemaining,
                PreviousStatus = entry.RosterStatus.ToString(),
                NewStatus = newStatus.ToString(),
            };
        }

        private static AdminTradePickSideDto BuildTradePickSideDto(
            DraftPick pick)
        {
            return new AdminTradePickSideDto
            {
                DraftPickId = pick.Id,
                DraftYear = pick.Draft.Season.NhlSeasonCode / 10000,
                Round = pick.Round,
                OriginalOwnerFantasyTeamName =
                    pick.OriginalOwnerFantasyTeam?.Name ?? string.Empty,
            };
        }

        private static TradeHistoryDto BuildTradeHistoryDto(
      TradeHistory h,
      Season? season,
      FantasyTeam? teamA,
      FantasyTeam? teamB,
      TradeSnapshotPayload payload)
        {
            return new TradeHistoryDto
            {
                Id = h.Id,
                SeasonId = h.SeasonId,
                SeasonName = season?.Name ?? $"#{h.SeasonId}",

                TeamAId = h.TeamAId,
                TeamAName = teamA?.Name ?? payload.TeamAName,

                TeamBId = h.TeamBId,
                TeamBName = teamB?.Name ?? payload.TeamBName,

                EffectiveAt = h.EffectiveAt,
                ConfirmedAt = h.ConfirmedAt,
                Note = h.Note,

                TeamASentPlayers = payload.TeamASentPlayers,
                TeamBSentPlayers = payload.TeamBSentPlayers,
                TeamASentPicks = payload.TeamASentPicks,
                TeamBSentPicks = payload.TeamBSentPicks,

                DateChanges = (h.DateChanges ?? new List<TradeDateChange>())
                    .OrderBy(dc => dc.ChangedAt)
                    .ThenBy(dc => dc.Id)
                    .Select(dc => new TradeDateChangeDto
                    {
                        Id = dc.Id,
                        PreviousEffectiveAt = dc.PreviousEffectiveAt,
                        NewEffectiveAt = dc.NewEffectiveAt,
                        ChangedAt = dc.ChangedAt,
                        Reason = dc.Reason,
                    })
                    .ToList(),
            };
        }

        private static FinalizeTradeResultDto TradeFailure(string message)
        {
            return new FinalizeTradeResultDto
            {
                Success = false,
                Message = message,
                TradeHistory = null,
            };
        }

        // =================================================================
        // Trade date change
        //
        // Moves a recorded trade's effective date. Every RosterStatusHistory
        // row whose TradeHistoryId points at this trade is updated to the
        // new instant, so the scoring recompute credits players to their
        // new teams starting from the new date. A TradeDateChange audit
        // row preserves the change history so the original date is never
        // lost.
        // =================================================================

        public async Task<ChangeTradeDateResultDto> ChangeTradeDateAsync(
            int tradeId,
            ChangeTradeDateRequest request,
            CancellationToken ct = default)
        {
            if (request.NewEffectiveAt == default)
            {
                return ChangeTradeDateFailure(
                    "NewEffectiveAt is required.");
            }

            var trade = await _dbContext.TradeHistories
                .FirstOrDefaultAsync(h => h.Id == tradeId, ct);

            if (trade == null)
            {
                return ChangeTradeDateFailure(
                    $"Trade {tradeId} not found.");
            }

            var normalized = NormalizeEffectiveAt(request.NewEffectiveAt);
            var previous = trade.EffectiveAt;

            if (normalized == previous)
            {
                return ChangeTradeDateFailure(
                    "The new effective date is identical to the current one.");
            }

            // Every history row owned by this trade.
            var linkedRows = await _dbContext.RosterStatusHistories
                .Where(h => h.TradeHistoryId == tradeId)
                .ToListAsync(ct);

            // Collision check: for each linked row, refuse if another
            // history row for the SAME player+season already sits at
            // the target date. Moving a trade on top of a manual
            // status change would create two sibling rows at the same
            // instant for the same player, which the recompute cannot
            // resolve deterministically.
            foreach (var row in linkedRows)
            {
                var collision = await _dbContext.RosterStatusHistories
                    .AnyAsync(h =>
                        h.Id != row.Id &&
                        h.TradeHistoryId != tradeId &&
                        h.PlayerId == row.PlayerId &&
                        h.SeasonId == row.SeasonId &&
                        h.EffectiveAt == normalized, ct);

                if (collision)
                {
                    return ChangeTradeDateFailure(
                        $"A history row for player {row.PlayerId} " +
                        $"already exists at {normalized:yyyy-MM-dd}. " +
                        "Choose a different date.");
                }
            }

            var trimmedReason = string.IsNullOrWhiteSpace(request.Reason)
                ? null
                : request.Reason!.Trim();

            if (trimmedReason != null && trimmedReason.Length > 500)
            {
                trimmedReason = trimmedReason.Substring(0, 500);
            }

            // Apply the date change to every linked history row.
            foreach (var row in linkedRows)
            {
                row.EffectiveAt = normalized;
                row.CreatedAt = DateTime.UtcNow;
            }

            trade.EffectiveAt = normalized;

            _dbContext.TradeDateChanges.Add(new TradeDateChange
            {
                TradeHistoryId = trade.Id,
                PreviousEffectiveAt = previous,
                NewEffectiveAt = normalized,
                ChangedAt = DateTime.UtcNow,
                Reason = trimmedReason,
            });

            await _dbContext.SaveChangesAsync(ct);

            OnRosterChanged();

            var updated = await LoadTradeHistoryDtoAsync(tradeId, ct);

            return new ChangeTradeDateResultDto
            {
                Success = true,
                Message =
                    $"Trade #{tradeId} date changed from " +
                    $"{previous:yyyy-MM-dd} to {normalized:yyyy-MM-dd}.",
                TradeHistory = updated,
            };
        }

        private static ChangeTradeDateResultDto ChangeTradeDateFailure(
      string message)
        {
            return new ChangeTradeDateResultDto
            {
                Success = false,
                Message = message,
                TradeHistory = null,
            };
        }

        // =================================================================
        // Revert trade (hard delete)
        //
        // Erases a recorded trade completely: players go back to their
        // original teams, draft picks go back to their original owners,
        // every RosterStatusHistory row created by the trade is deleted,
        // the TradeDateChange audit rows are deleted, and the
        // TradeHistory row itself is deleted. A recompute is queued so
        // FantasyTeamSeason totals are rebuilt from the (now restored)
        // pre-trade state, crediting every game the traded players ever
        // played to their original teams.
        //
        // Guards, in order:
        //   1. Trade exists.
        //   2. Snapshot deserializes.
        //   3. Every traded player's LATEST history row for the
        //      season is one of this trade's own rows. A player who
        //      has had ANY status change, transfer, or release since
        //      the trade would fail this check.
        //   4. Every traded pick's current owner is still the team
        //      that received it from this trade. A pick that was
        //      re-transferred since would fail this check.
        //   5. Number of linked history rows matches 2 × player count
        //      (data integrity).
        //
        // Any guard failure leaves the trade untouched, so the
        // commissioner can fix the downstream dependency and retry.
        //
        // NOT restored: marketplace TradeOffer / TradeOfferResponse
        // rows that were auto-deleted during FinalizeTradeAsync. Those
        // were invalidated by the trade going through, and there is no
        // record of them to bring back. Everything else is erased.
        //
        // No schema change: uses existing tables and columns.
        // =================================================================

        public async Task<RevertTradeResultDto> RevertTradeAsync(
            int tradeId,
            CancellationToken ct = default)
        {
            var trade = await _dbContext.TradeHistories
                .Include(h => h.DateChanges)
                .FirstOrDefaultAsync(h => h.Id == tradeId, ct);

            if (trade == null)
            {
                return RevertTradeFailure(
                    $"Trade #{tradeId} not found.");
            }

            // ---- Guard: snapshot integrity -----------------------------

            TradeSnapshotPayload? snapshot;

            try
            {
                snapshot = System.Text.Json.JsonSerializer
                    .Deserialize<TradeSnapshotPayload>(
                        trade.SnapshotJson);
            }
            catch (Exception ex)
            {
                return RevertTradeFailure(
                    $"Trade snapshot is corrupt: {ex.GetType().Name}. " +
                    "Cannot revert.");
            }

            if (snapshot == null)
            {
                return RevertTradeFailure(
                    "Trade snapshot is empty. Cannot revert.");
            }

            var snapshotPlayerIds = snapshot.TeamASentPlayers
                .Select(p => p.PlayerId)
                .Concat(snapshot.TeamBSentPlayers.Select(p => p.PlayerId))
                .Distinct()
                .ToList();

            // ---- Guard: player-level downstream changes ----------------

            var linkedRows = await _dbContext.RosterStatusHistories
                .Where(h => h.TradeHistoryId == tradeId)
                .ToListAsync(ct);

            if (linkedRows.Count != snapshotPlayerIds.Count * 2)
            {
                return RevertTradeFailure(
                    "Data integrity error: expected " +
                    $"{snapshotPlayerIds.Count * 2} linked history rows " +
                    $"for {snapshotPlayerIds.Count} player(s), found " +
                    $"{linkedRows.Count}. Cannot revert safely. " +
                    "Check the trade's history rows in the DB.");
            }

            if (snapshotPlayerIds.Count > 0)
            {
                var allHistory = await _dbContext.RosterStatusHistories
                    .AsNoTracking()
                    .Where(h =>
                        h.SeasonId == trade.SeasonId &&
                        snapshotPlayerIds.Contains(h.PlayerId))
                    .OrderBy(h => h.PlayerId)
                    .ThenBy(h => h.EffectiveAt)
                    .ThenBy(h => h.Id)
                    .ToListAsync(ct);

                var latestByPlayer = allHistory
                    .GroupBy(h => h.PlayerId)
                    .ToDictionary(g => g.Key, g => g.Last());

                var blocked = new List<string>();

                foreach (var playerId in snapshotPlayerIds)
                {
                    if (!latestByPlayer.TryGetValue(
                            playerId, out var latest) ||
                        latest.TradeHistoryId != tradeId)
                    {
                        var playerName = snapshot
                            .TeamASentPlayers
                            .Concat(snapshot.TeamBSentPlayers)
                            .FirstOrDefault(p => p.PlayerId == playerId);

                        blocked.Add(playerName != null
                            ? $"{playerName.FirstName} {playerName.LastName}"
                            : $"player #{playerId}");
                    }
                }

                if (blocked.Count > 0)
                {
                    return RevertTradeFailure(
                        "Impossible de revertir cet échange : les " +
                        "joueurs suivants ont eu des changements de " +
                        "statut ou d'équipe après l'échange : " +
                        string.Join(", ", blocked) + ". " +
                        "Revertissez d'abord les changements " +
                        "postérieurs (ou ajustez-les manuellement), " +
                        "puis réessayez.");
                }
            }

            // ---- Guard: draft-pick downstream transfers ----------------

            var snapshotPickIds = snapshot.TeamASentPicks
                .Select(p => p.DraftPickId)
                .Concat(snapshot.TeamBSentPicks.Select(p => p.DraftPickId))
                .Distinct()
                .ToList();

            if (snapshotPickIds.Count > 0)
            {
                var currentPicks = await _dbContext.DraftPicks
                    .AsNoTracking()
                    .Where(p => snapshotPickIds.Contains(p.Id))
                    .ToDictionaryAsync(p => p.Id, ct);

                var blockedPicks = new List<string>();

                foreach (var pick in snapshot.TeamASentPicks)
                {
                    // Was sent from A → B; current owner must still be B.
                    if (!currentPicks.TryGetValue(
                            pick.DraftPickId, out var p) ||
                        p.CurrentOwnerFantasyTeamId != trade.TeamBId)
                    {
                        blockedPicks.Add(
                            $"#{pick.DraftPickId} ({pick.DraftYear}, " +
                            $"Ronde {pick.Round})");
                    }
                }

                foreach (var pick in snapshot.TeamBSentPicks)
                {
                    // Was sent from B → A; current owner must still be A.
                    if (!currentPicks.TryGetValue(
                            pick.DraftPickId, out var p) ||
                        p.CurrentOwnerFantasyTeamId != trade.TeamAId)
                    {
                        blockedPicks.Add(
                            $"#{pick.DraftPickId} ({pick.DraftYear}, " +
                            $"Ronde {pick.Round})");
                    }
                }

                if (blockedPicks.Count > 0)
                {
                    return RevertTradeFailure(
                        "Impossible de revertir cet échange : les choix " +
                        "de repêchage suivants ont été ré-échangés " +
                        "depuis : " + string.Join(", ", blockedPicks) +
                        ". Revertissez ces transferts d'abord, puis " +
                        "réessayez.");
                }
            }

            // ---- All guards passed. Execute the revert. ----------------
            //
            // Order matters for correctness of the SaveChanges:
            //   1. Delete the trade's history rows (FK is Restrict to
            //      TradeHistory, so they must go first).
            //   2. Delete the TradeDateChange rows.
            //   3. Delete the TradeHistory row.
            //   4. Move RosterEntry rows back.
            //   5. Move DraftPick rows back.
            // Everything is in one SaveChangesAsync, so it is atomic.

            _dbContext.RosterStatusHistories.RemoveRange(linkedRows);

            if (trade.DateChanges.Count > 0)
            {
                _dbContext.TradeDateChanges.RemoveRange(
                    trade.DateChanges);
            }

            _dbContext.TradeHistories.Remove(trade);

            if (snapshotPlayerIds.Count > 0)
            {
                var aSendingIds = snapshot.TeamASentPlayers
                    .Select(p => p.PlayerId)
                    .ToList();

                if (aSendingIds.Count > 0)
                {
                    var aSendingEntries = await _dbContext.RosterEntries
                        .Where(e =>
                            e.SeasonId == trade.SeasonId &&
                            aSendingIds.Contains(e.PlayerId))
                        .ToListAsync(ct);

                    foreach (var e in aSendingEntries)
                    {
                        e.FantasyTeamId = trade.TeamAId;
                    }
                }

                var bSendingIds = snapshot.TeamBSentPlayers
                    .Select(p => p.PlayerId)
                    .ToList();

                if (bSendingIds.Count > 0)
                {
                    var bSendingEntries = await _dbContext.RosterEntries
                        .Where(e =>
                            e.SeasonId == trade.SeasonId &&
                            bSendingIds.Contains(e.PlayerId))
                        .ToListAsync(ct);

                    foreach (var e in bSendingEntries)
                    {
                        e.FantasyTeamId = trade.TeamBId;
                    }
                }
            }

            if (snapshotPickIds.Count > 0)
            {
                var aSentPickIds = snapshot.TeamASentPicks
                    .Select(p => p.DraftPickId)
                    .ToList();

                if (aSentPickIds.Count > 0)
                {
                    var aSentPicks = await _dbContext.DraftPicks
                        .Where(p => aSentPickIds.Contains(p.Id))
                        .ToListAsync(ct);

                    foreach (var p in aSentPicks)
                    {
                        p.CurrentOwnerFantasyTeamId = trade.TeamAId;
                    }
                }

                var bSentPickIds = snapshot.TeamBSentPicks
                    .Select(p => p.DraftPickId)
                    .ToList();

                if (bSentPickIds.Count > 0)
                {
                    var bSentPicks = await _dbContext.DraftPicks
                        .Where(p => bSentPickIds.Contains(p.Id))
                        .ToListAsync(ct);

                    foreach (var p in bSentPicks)
                    {
                        p.CurrentOwnerFantasyTeamId = trade.TeamBId;
                    }
                }
            }

            await _dbContext.SaveChangesAsync(ct);

            OnRosterChanged();

            return new RevertTradeResultDto
            {
                Success = true,
                Message =
                    $"Échange #{tradeId} reverti. Les joueurs et les " +
                    "choix sont revenus à leurs équipes d'origine, " +
                    "tout l'historique lié a été supprimé, et les " +
                    "totaux de la saison vont être recalculés comme " +
                    "si l'échange n'avait jamais eu lieu.",
            };
        }

        private static RevertTradeResultDto RevertTradeFailure(
       string message)
        {
            return new RevertTradeResultDto
            {
                Success = false,
                Message = message,
            };
        }

        // =================================================================
        // Batch status change (commissioner-executed)
        //
        // One endpoint drives the "Changer des statuts" form: the admin
        // sends a batch of paired slots (StatusA-side player ↔ StatusB-
        // side player), both status names, an effective date, and an
        // optional note. We validate, apply, and persist an immutable
        // StatusChangeHistory row in one transaction.
        //
        // The whole flow mirrors FinalizeTradeAsync, minus the two-team
        // structure (all pairs are on the SAME team) and minus the
        // draft-pick side (status changes do not touch picks).
        // =================================================================

        public async Task<FinalizeStatusChangeResultDto>
            FinalizeStatusChangeAsync(
                FinalizeStatusChangeRequest request,
                CancellationToken ct = default)
        {
            if (request.FantasyTeamId <= 0)
            {
                return StatusChangeFailure(
                    "FantasyTeamId is required.");
            }

            if (request.EffectiveAt == default)
            {
                return StatusChangeFailure("EffectiveAt is required.");
            }

            if (!TryParseLiveStatus(request.StatusA, out var statusA))
            {
                return StatusChangeFailure(
                    "StatusA must be Active, Bench or Prospect.");
            }

            if (!TryParseLiveStatus(request.StatusB, out var statusB))
            {
                return StatusChangeFailure(
                    "StatusB must be Active, Bench or Prospect.");
            }

            if (statusA == statusB)
            {
                return StatusChangeFailure(
                    "StatusA and StatusB must be different.");
            }

            if (request.Pairs == null || request.Pairs.Count == 0)
            {
                return StatusChangeFailure(
                    "At least one pair is required.");
            }

            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
                _dbContext, ct);

            if (season == null)
            {
                return StatusChangeFailure(
                    "No current season. Run POST /api/League/setup first.");
            }

            var team = await _dbContext.FantasyTeams
                .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId, ct);

            if (team == null)
            {
                return StatusChangeFailure(
                    $"Fantasy team {request.FantasyTeamId} not found.");
            }

            // ---- Collect every player id --------------------------------

            var allPlayerIds = request.Pairs
                .SelectMany(p => new[]
                {
                    p.StatusASidePlayerId ?? 0,
                    p.StatusBSidePlayerId ?? 0,
                })
                .Where(id => id > 0)
                .Distinct()
                .ToList();

            if (allPlayerIds.Count != request.Pairs.Count * 2)
            {
                return StatusChangeFailure(
                    "Every pair needs two distinct players. " +
                    "Duplicate players or empty slots are not allowed.");
            }

            var entries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                    .ThenInclude(p => p.NhlTeam)
                .Where(e =>
                    e.SeasonId == season.Id &&
                    allPlayerIds.Contains(e.PlayerId))
                .ToListAsync(ct);

            var entriesByPlayerId = entries.ToDictionary(e => e.PlayerId);

            // ---- Per-pair validation -----------------------------------

            for (var i = 0; i < request.Pairs.Count; i++)
            {
                var pair = request.Pairs[i];

                if (!pair.StatusASidePlayerId.HasValue ||
                    !pair.StatusBSidePlayerId.HasValue)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: both players are required.");
                }

                if (!entriesByPlayerId.TryGetValue(
                        pair.StatusASidePlayerId.Value, out var eA))
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: player " +
                        $"{pair.StatusASidePlayerId.Value} not found.");
                }

                if (!entriesByPlayerId.TryGetValue(
                        pair.StatusBSidePlayerId.Value, out var eB))
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: player " +
                        $"{pair.StatusBSidePlayerId.Value} not found.");
                }

                if (eA.FantasyTeamId != request.FantasyTeamId)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: {eA.Player.FirstName} " +
                        $"{eA.Player.LastName} is not on {team.Name}.");
                }

                if (eB.FantasyTeamId != request.FantasyTeamId)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: {eB.Player.FirstName} " +
                        $"{eB.Player.LastName} is not on {team.Name}.");
                }

                if (eA.RosterStatus != statusA)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: {eA.Player.FirstName} " +
                        $"{eA.Player.LastName} does not currently have " +
                        $"status {statusA}.");
                }

                if (eB.RosterStatus != statusB)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: {eB.Player.FirstName} " +
                        $"{eB.Player.LastName} does not currently have " +
                        $"status {statusB}.");
                }

                var gA = PositionGroupHelper.Classify(eA.Player.Position);
                var gB = PositionGroupHelper.Classify(eB.Player.Position);

                if (gA == PositionGroup.Unknown ||
                    gB == PositionGroup.Unknown)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: cannot classify position of " +
                        $"{eA.Player.FirstName} {eA.Player.LastName} or " +
                        $"{eB.Player.FirstName} {eB.Player.LastName}.");
                }

                if (gA != gB)
                {
                    return StatusChangeFailure(
                        $"Slot {i + 1}: position mismatch. " +
                        $"{eA.Player.FirstName} {eA.Player.LastName} " +
                        $"is {gA}, {eB.Player.FirstName} " +
                        $"{eB.Player.LastName} is {gB}. Both players " +
                        "of a pair must have the same position.");
                }
            }

            // ---- Shape validation after simulated swap -----------------

            var shapeFailure = await ValidateStatusChangeShapeAsync(
                request.FantasyTeamId,
                season.Id,
                request.Pairs,
                statusA,
                statusB,
                ct);

            if (shapeFailure != null)
            {
                return StatusChangeFailure(shapeFailure);
            }

            // ---- Build the snapshot ------------------------------------

            var pairDtos = new List<StatusChangePairDto>();

            for (var i = 0; i < request.Pairs.Count; i++)
            {
                var pair = request.Pairs[i];
                var eA = entriesByPlayerId[pair.StatusASidePlayerId!.Value];
                var eB = entriesByPlayerId[pair.StatusBSidePlayerId!.Value];

                pairDtos.Add(new StatusChangePairDto
                {
                    SlotIndex = i,
                    StatusASide = new AdminStatusChangePlayerSideDto
                    {
                        PlayerId = eA.PlayerId,
                        NhlPlayerId = eA.Player.NhlPlayerId,
                        FirstName = eA.Player.FirstName,
                        LastName = eA.Player.LastName,
                        Position = eA.Player.Position,
                        NhlTeamAbbreviation =
                            eA.Player.NhlTeam?.Abbreviation ?? string.Empty,
                        PreviousStatusName = statusA.ToString(),
                        NewStatusName = statusB.ToString(),
                    },
                    StatusBSide = new AdminStatusChangePlayerSideDto
                    {
                        PlayerId = eB.PlayerId,
                        NhlPlayerId = eB.Player.NhlPlayerId,
                        FirstName = eB.Player.FirstName,
                        LastName = eB.Player.LastName,
                        Position = eB.Player.Position,
                        NhlTeamAbbreviation =
                            eB.Player.NhlTeam?.Abbreviation ?? string.Empty,
                        PreviousStatusName = statusB.ToString(),
                        NewStatusName = statusA.ToString(),
                    },
                });
            }

            var normalizedEffectiveAt = NormalizeEffectiveAt(
                request.EffectiveAt);

            var trimmedNote = string.IsNullOrWhiteSpace(request.Note)
                ? null
                : request.Note!.Trim();

            if (trimmedNote != null && trimmedNote.Length > 500)
            {
                trimmedNote = trimmedNote.Substring(0, 500);
            }

            var snapshot = new StatusChangeSnapshotPayload
            {
                FantasyTeamId = team.Id,
                FantasyTeamName = team.Name,
                StatusAName = statusA.ToString(),
                StatusBName = statusB.ToString(),
                EffectiveAt = normalizedEffectiveAt,
                Pairs = pairDtos,
            };

            var history = new StatusChangeHistory
            {
                SeasonId = season.Id,
                FantasyTeamId = team.Id,
                StatusAName = statusA.ToString(),
                StatusBName = statusB.ToString(),
                EffectiveAt = normalizedEffectiveAt,
                ConfirmedAt = DateTime.UtcNow,
                Note = trimmedNote,
                SnapshotJson = System.Text.Json.JsonSerializer
                    .Serialize(snapshot),
            };

            // ---- Apply -------------------------------------------------
            //
            // The history object is passed as the nav property so EF
            // orders the inserts correctly inside the one SaveChanges
            // (StatusChangeHistory row first, then the linked history
            // rows).

            var historyNote =
                trimmedNote ?? $"Swap {statusA} ↔ {statusB}";

            foreach (var pair in request.Pairs)
            {
                var eA = entriesByPlayerId[pair.StatusASidePlayerId!.Value];
                var eB = entriesByPlayerId[pair.StatusBSidePlayerId!.Value];

                AddHistoryRow(
                    eA.PlayerId, team.Id, season.Id,
                    statusB, normalizedEffectiveAt,
                    historyNote, null, history);

                AddHistoryRow(
                    eB.PlayerId, team.Id, season.Id,
                    statusA, normalizedEffectiveAt,
                    historyNote, null, history);

                eA.RosterStatus = statusB;
                eB.RosterStatus = statusA;
            }

            _dbContext.StatusChangeHistories.Add(history);

            await _dbContext.SaveChangesAsync(ct);

            OnRosterChanged();

            return new FinalizeStatusChangeResultDto
            {
                Success = true,
                Message =
                    $"Changement de statut confirmé pour {team.Name}.",
                StatusChangeHistory = BuildStatusChangeHistoryDto(
                    history, season, team, snapshot),
            };
        }

        public async Task<List<StatusChangeHistoryDto>>
            GetStatusChangeHistoryAsync(
                int? seasonId,
                CancellationToken ct = default)
        {
            var query = _dbContext.StatusChangeHistories
                .AsNoTracking()
                .Include(h => h.Season)
                .Include(h => h.FantasyTeam)
                .Include(h => h.DateChanges)
                .AsQueryable();

            if (seasonId.HasValue)
            {
                query = query.Where(h => h.SeasonId == seasonId.Value);
            }

            var rows = await query
                .OrderByDescending(h => h.ConfirmedAt)
                .ToListAsync(ct);

            var result = new List<StatusChangeHistoryDto>();

            foreach (var row in rows)
            {
                StatusChangeSnapshotPayload? payload;

                try
                {
                    payload = System.Text.Json.JsonSerializer
                        .Deserialize<StatusChangeSnapshotPayload>(
                            row.SnapshotJson);
                }
                catch
                {
                    continue;
                }

                if (payload == null) continue;

                result.Add(BuildStatusChangeHistoryDto(
                    row, row.Season, row.FantasyTeam, payload));
            }

            return result;
        }

        public async Task<ChangeStatusChangeDateResultDto>
            ChangeStatusChangeDateAsync(
                int statusChangeId,
                ChangeStatusChangeDateRequest request,
                CancellationToken ct = default)
        {
            if (request.NewEffectiveAt == default)
            {
                return ChangeStatusChangeDateFailure(
                    "NewEffectiveAt is required.");
            }

            var history = await _dbContext.StatusChangeHistories
                .FirstOrDefaultAsync(h => h.Id == statusChangeId, ct);

            if (history == null)
            {
                return ChangeStatusChangeDateFailure(
                    $"Status change {statusChangeId} not found.");
            }

            var normalized = NormalizeEffectiveAt(request.NewEffectiveAt);
            var previous = history.EffectiveAt;

            if (normalized == previous)
            {
                return ChangeStatusChangeDateFailure(
                    "The new effective date is identical to the current one.");
            }

            var linkedRows = await _dbContext.RosterStatusHistories
                .Where(h => h.StatusChangeHistoryId == statusChangeId)
                .ToListAsync(ct);

            foreach (var row in linkedRows)
            {
                var collision = await _dbContext.RosterStatusHistories
                    .AnyAsync(h =>
                        h.Id != row.Id &&
                        h.StatusChangeHistoryId != statusChangeId &&
                        h.PlayerId == row.PlayerId &&
                        h.SeasonId == row.SeasonId &&
                        h.EffectiveAt == normalized, ct);

                if (collision)
                {
                    return ChangeStatusChangeDateFailure(
                        $"A history row for player {row.PlayerId} " +
                        $"already exists at {normalized:yyyy-MM-dd}. " +
                        "Choose a different date.");
                }
            }

            var trimmedReason = string.IsNullOrWhiteSpace(request.Reason)
                ? null
                : request.Reason!.Trim();

            if (trimmedReason != null && trimmedReason.Length > 500)
            {
                trimmedReason = trimmedReason.Substring(0, 500);
            }

            foreach (var row in linkedRows)
            {
                row.EffectiveAt = normalized;
                row.CreatedAt = DateTime.UtcNow;
            }

            history.EffectiveAt = normalized;

            _dbContext.StatusChangeDateChanges.Add(
                new StatusChangeDateChange
                {
                    StatusChangeHistoryId = history.Id,
                    PreviousEffectiveAt = previous,
                    NewEffectiveAt = normalized,
                    ChangedAt = DateTime.UtcNow,
                    Reason = trimmedReason,
                });

            await _dbContext.SaveChangesAsync(ct);

            OnRosterChanged();

            var updated = await LoadStatusChangeHistoryDtoAsync(
                statusChangeId, ct);

            return new ChangeStatusChangeDateResultDto
            {
                Success = true,
                Message =
                    $"Changement de statut #{statusChangeId} : " +
                    $"{previous:yyyy-MM-dd} → {normalized:yyyy-MM-dd}.",
                StatusChangeHistory = updated,
            };
        }

        public async Task<RevertStatusChangeResultDto>
            RevertStatusChangeAsync(
                int statusChangeId,
                CancellationToken ct = default)
        {
            var history = await _dbContext.StatusChangeHistories
                .Include(h => h.DateChanges)
                .FirstOrDefaultAsync(h => h.Id == statusChangeId, ct);

            if (history == null)
            {
                return RevertStatusChangeFailure(
                    $"Status change #{statusChangeId} not found.");
            }

            StatusChangeSnapshotPayload? snapshot;

            try
            {
                snapshot = System.Text.Json.JsonSerializer
                    .Deserialize<StatusChangeSnapshotPayload>(
                        history.SnapshotJson);
            }
            catch (Exception ex)
            {
                return RevertStatusChangeFailure(
                    $"Snapshot corrompu : {ex.GetType().Name}. " +
                    "Impossible de revertir.");
            }

            if (snapshot == null || snapshot.Pairs.Count == 0)
            {
                return RevertStatusChangeFailure(
                    "Snapshot vide. Impossible de revertir.");
            }

            var allPlayerIds = snapshot.Pairs
                .SelectMany(p => new[]
                {
                    p.StatusASide.PlayerId,
                    p.StatusBSide.PlayerId,
                })
                .Distinct()
                .ToList();

            var linkedRows = await _dbContext.RosterStatusHistories
                .Where(h => h.StatusChangeHistoryId == statusChangeId)
                .ToListAsync(ct);

            if (linkedRows.Count != allPlayerIds.Count * 2)
            {
                return RevertStatusChangeFailure(
                    "Erreur d'intégrité : " +
                    $"{allPlayerIds.Count * 2} lignes d'historique " +
                    $"attendues, {linkedRows.Count} trouvées. " +
                    "Impossible de revertir.");
            }

            // Guard: latest history for each player must be one of this
            // status change's rows.
            var allHistory = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h =>
                    h.SeasonId == history.SeasonId &&
                    allPlayerIds.Contains(h.PlayerId))
                .OrderBy(h => h.PlayerId)
                .ThenBy(h => h.EffectiveAt)
                .ThenBy(h => h.Id)
                .ToListAsync(ct);

            var latestByPlayer = allHistory
                .GroupBy(h => h.PlayerId)
                .ToDictionary(g => g.Key, g => g.Last());

            var blocked = new List<string>();

            foreach (var playerId in allPlayerIds)
            {
                if (!latestByPlayer.TryGetValue(playerId, out var latest) ||
                    latest.StatusChangeHistoryId != statusChangeId)
                {
                    var side = snapshot.Pairs
                        .SelectMany(p => new[]
                        {
                            p.StatusASide, p.StatusBSide,
                        })
                        .FirstOrDefault(p => p.PlayerId == playerId);

                    blocked.Add(side != null
                        ? $"{side.FirstName} {side.LastName}"
                        : $"player #{playerId}");
                }
            }

            if (blocked.Count > 0)
            {
                return RevertStatusChangeFailure(
                    "Impossible de revertir : les joueurs suivants ont " +
                    "eu des changements après ce changement de statut : " +
                    string.Join(", ", blocked) +
                    ". Revertissez d'abord les changements postérieurs.");
            }

            // ---- Execute the revert ------------------------------------

            _dbContext.RosterStatusHistories.RemoveRange(linkedRows);

            if (history.DateChanges.Count > 0)
            {
                _dbContext.StatusChangeDateChanges.RemoveRange(
                    history.DateChanges);
            }

            _dbContext.StatusChangeHistories.Remove(history);

            // Restore each player's RosterStatus to their previous status.
            var entryIds = allPlayerIds.Distinct().ToList();

            var entries = await _dbContext.RosterEntries
                .Where(e =>
                    e.SeasonId == history.SeasonId &&
                    entryIds.Contains(e.PlayerId))
                .ToListAsync(ct);

            var entriesByPlayerId = entries.ToDictionary(e => e.PlayerId);

            foreach (var pair in snapshot.Pairs)
            {
                if (entriesByPlayerId.TryGetValue(
                        pair.StatusASide.PlayerId, out var eA))
                {
                    if (Enum.TryParse<RosterStatus>(
                            pair.StatusASide.PreviousStatusName,
                            ignoreCase: true, out var prevA))
                    {
                        eA.RosterStatus = prevA;
                    }
                }

                if (entriesByPlayerId.TryGetValue(
                        pair.StatusBSide.PlayerId, out var eB))
                {
                    if (Enum.TryParse<RosterStatus>(
                            pair.StatusBSide.PreviousStatusName,
                            ignoreCase: true, out var prevB))
                    {
                        eB.RosterStatus = prevB;
                    }
                }
            }

            await _dbContext.SaveChangesAsync(ct);

            OnRosterChanged();

            return new RevertStatusChangeResultDto
            {
                Success = true,
                Message =
                    $"Changement de statut #{statusChangeId} reverti. " +
                    "Les joueurs sont revenus à leurs statuts d'origine, " +
                    "tout l'historique lié a été supprimé, et les totaux " +
                    "vont être recalculés comme si le changement " +
                    "n'avait jamais eu lieu.",
            };
        }

        private async Task<string?> ValidateStatusChangeShapeAsync(
            int fantasyTeamId,
            int seasonId,
            List<StatusChangePairRequest> pairs,
            RosterStatus statusA,
            RosterStatus statusB,
            CancellationToken ct)
        {
            var entries = await _dbContext.RosterEntries
                .Include(e => e.Player)
                .Where(e =>
                    e.SeasonId == seasonId &&
                    e.FantasyTeamId == fantasyTeamId)
                .ToListAsync(ct);

            var swapMap = new Dictionary<int, RosterStatus>();

            foreach (var pair in pairs)
            {
                if (pair.StatusASidePlayerId.HasValue)
                {
                    swapMap[pair.StatusASidePlayerId.Value] = statusB;
                }

                if (pair.StatusBSidePlayerId.HasValue)
                {
                    swapMap[pair.StatusBSidePlayerId.Value] = statusA;
                }
            }

            int activeF = 0, activeD = 0, activeG = 0;
            int benchF = 0, benchD = 0, benchG = 0;
            int prospects = 0;

            foreach (var entry in entries)
            {
                var status = swapMap.TryGetValue(
                    entry.PlayerId, out var ns)
                    ? ns
                    : entry.RosterStatus;

                if (status == RosterStatus.Prospect)
                {
                    prospects++;
                    continue;
                }

                var group = PositionGroupHelper.Classify(
                    entry.Player.Position);

                if (group == PositionGroup.Unknown)
                {
                    return
                        $"Unclassifiable position " +
                        $"'{entry.Player.Position}' for " +
                        $"{entry.Player.FirstName} {entry.Player.LastName}.";
                }

                if (status == RosterStatus.Active)
                {
                    switch (group)
                    {
                        case PositionGroup.Forward: activeF++; break;
                        case PositionGroup.Defense: activeD++; break;
                        case PositionGroup.Goalie: activeG++; break;
                    }
                }
                else if (status == RosterStatus.Bench)
                {
                    switch (group)
                    {
                        case PositionGroup.Forward: benchF++; break;
                        case PositionGroup.Defense: benchD++; break;
                        case PositionGroup.Goalie: benchG++; break;
                    }
                }
            }

            if (activeF != 12 || activeD != 6 || activeG != 1 ||
                benchF != 4 || benchD != 2 || benchG != 1 ||
                prospects != 3)
            {
                return
                    $"Après le changement, l'équipe aurait " +
                    $"{activeF}F/{activeD}D/{activeG}G actifs, " +
                    $"{benchF}F/{benchD}D/{benchG}G sur le banc, " +
                    $"{prospects} prospect(s). " +
                    "Requis : 12F/6D/1G actifs, 4F/2D/1G banc, " +
                    "3 prospects.";
            }

            return null;
        }

        private static FinalizeStatusChangeResultDto StatusChangeFailure(
            string message)
        {
            return new FinalizeStatusChangeResultDto
            {
                Success = false,
                Message = message,
                StatusChangeHistory = null,
            };
        }

        private static ChangeStatusChangeDateResultDto
            ChangeStatusChangeDateFailure(string message)
        {
            return new ChangeStatusChangeDateResultDto
            {
                Success = false,
                Message = message,
                StatusChangeHistory = null,
            };
        }

        private static RevertStatusChangeResultDto
            RevertStatusChangeFailure(string message)
        {
            return new RevertStatusChangeResultDto
            {
                Success = false,
                Message = message,
            };
        }

        private async Task<StatusChangeHistoryDto?>
            LoadStatusChangeHistoryDtoAsync(
                int id,
                CancellationToken ct)
        {
            var row = await _dbContext.StatusChangeHistories
                .AsNoTracking()
                .Include(h => h.Season)
                .Include(h => h.FantasyTeam)
                .Include(h => h.DateChanges)
                .FirstOrDefaultAsync(h => h.Id == id, ct);

            if (row == null) return null;

            StatusChangeSnapshotPayload? payload;

            try
            {
                payload = System.Text.Json.JsonSerializer
                    .Deserialize<StatusChangeSnapshotPayload>(
                        row.SnapshotJson);
            }
            catch
            {
                return null;
            }

            if (payload == null) return null;

            return BuildStatusChangeHistoryDto(
                row, row.Season, row.FantasyTeam, payload);
        }

        private static StatusChangeHistoryDto BuildStatusChangeHistoryDto(
            StatusChangeHistory h,
            Season? season,
            FantasyTeam? team,
            StatusChangeSnapshotPayload payload)
        {
            return new StatusChangeHistoryDto
            {
                Id = h.Id,
                SeasonId = h.SeasonId,
                SeasonName = season?.Name ?? $"#{h.SeasonId}",

                FantasyTeamId = h.FantasyTeamId,
                FantasyTeamName = team?.Name ?? payload.FantasyTeamName,

                StatusAName = h.StatusAName,
                StatusBName = h.StatusBName,

                EffectiveAt = h.EffectiveAt,
                ConfirmedAt = h.ConfirmedAt,
                Note = h.Note,

                Pairs = payload.Pairs,

                DateChanges = (h.DateChanges ??
                    new List<StatusChangeDateChange>())
                    .OrderBy(dc => dc.ChangedAt)
                    .ThenBy(dc => dc.Id)
                    .Select(dc => new StatusChangeDateChangeDto
                    {
                        Id = dc.Id,
                        PreviousEffectiveAt = dc.PreviousEffectiveAt,
                        NewEffectiveAt = dc.NewEffectiveAt,
                        ChangedAt = dc.ChangedAt,
                        Reason = dc.Reason,
                    })
                    .ToList(),
            };
        }

        /// <summary>
        /// Same rule as TryParseRosterStatus but explicitly rejects
        /// Released. Released is a terminal status that only ever
        /// appears on history rows, never as a live status.
        /// </summary>
        private static bool TryParseLiveStatus(
            string? value,
            out RosterStatus status)
        {
            if (string.IsNullOrWhiteSpace(value))
            {
                status = RosterStatus.Active;
                return false;
            }

            if (!Enum.TryParse(value, ignoreCase: true, out status))
            {
                return false;
            }

            if (!Enum.IsDefined(status))
            {
                return false;
            }

            return status != RosterStatus.Released;
        }

        private async Task<TradeHistoryDto?> LoadTradeHistoryDtoAsync(
            int tradeId,
            CancellationToken ct)
        {
            var row = await _dbContext.TradeHistories
                .AsNoTracking()
                .Include(h => h.Season)
                .Include(h => h.TeamA)
                .Include(h => h.TeamB)
                .Include(h => h.DateChanges)
                .FirstOrDefaultAsync(h => h.Id == tradeId, ct);

            if (row == null)
            {
                return null;
            }

            TradeSnapshotPayload? payload;

            try
            {
                payload = System.Text.Json.JsonSerializer
                    .Deserialize<TradeSnapshotPayload>(row.SnapshotJson);
            }
            catch
            {
                return null;
            }

            if (payload == null)
            {
                return null;
            }

            return BuildTradeHistoryDto(
                row, row.Season, row.TeamA, row.TeamB, payload);
        }

        /// <summary>
        /// Returns every game log for every player who was ever in the
        /// ACTIVE starting lineup for the given fantasy team during the
        /// given season.
        ///
        /// Players who were traded away are included for the games they
        /// played while they were Active on this team.
        /// Players who arrived mid-season are included for the games they
        /// played while they were Active on this team.
        ///
        /// Uses the same history-slicing logic as the scoring recompute:
        /// for each game, look up the last RosterStatusHistory row that
        /// was effective at the start of the game day. Only include the
        /// game log if that effective row belonged to this fantasy team
        /// AND its status was Active.
        /// </summary>
        public async Task<List<ActivePlayerGameLogDto>> GetActiveGameLogsForTeamAsync(
            int fantasyTeamId,
            int? seasonId,
            CancellationToken ct = default)
        {
            var season = await ResolveSeasonAsync(seasonId);

            if (season == null)
            {
                return new List<ActivePlayerGameLogDto>();
            }

            // 1. Find every player who has at least one history row
            // for this team during the season.
            var playerIds = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h =>
                    h.SeasonId == season.Id &&
                    h.FantasyTeamId == fantasyTeamId)
                .Select(h => h.PlayerId)
                .Distinct()
                .ToListAsync(ct);

            if (playerIds.Count == 0)
            {
                return new List<ActivePlayerGameLogDto>();
            }

            // 2. Load the full history for those players in this
            // season so we can slice it per game.
            var allHistory = await _dbContext.RosterStatusHistories
                .AsNoTracking()
                .Where(h =>
                    h.SeasonId == season.Id &&
                    playerIds.Contains(h.PlayerId))
                .OrderBy(h => h.EffectiveAt)
                .ThenBy(h => h.Id)
                .ToListAsync(ct);

            var historyByPlayer = allHistory
                .GroupBy(h => h.PlayerId)
                .ToDictionary(
                    g => g.Key,
                    g => g.OrderBy(h => h.EffectiveAt).ThenBy(h => h.Id).ToList());

            // 3. Load every game log for those players in this season.
            var gameLogs = await _dbContext.PlayerGameLogs
                .AsNoTracking()
                .Include(g => g.Player)
                .Where(g =>
                    g.SeasonId == season.Id &&
                    playerIds.Contains(g.PlayerId))
                .OrderBy(g => g.GameDate)
                .ThenBy(g => g.Player!.LastName)
                .ToListAsync(ct);

            var result = new List<ActivePlayerGameLogDto>();

            // 4. Slice the history and filter the game logs.
            foreach (var log in gameLogs)
            {
                if (!historyByPlayer.TryGetValue(log.PlayerId, out var history) ||
                    history.Count == 0)
                {
                    continue;
                }

                var gameDayUtc = new DateTime(
                    log.GameDate.Year,
                    log.GameDate.Month,
                    log.GameDate.Day,
                    0, 0, 0,
                    DateTimeKind.Utc);

                RosterStatusHistory? effective = null;

                foreach (var row in history)
                {
                    if (row.EffectiveAt <= gameDayUtc)
                    {
                        effective = row;
                    }
                    else
                    {
                        break;
                    }
                }

                // Only include the log if the player was active on
                // THIS team on that specific day.
                if (effective != null &&
                    effective.FantasyTeamId == fantasyTeamId &&
                    effective.RosterStatus == RosterStatus.Active)
                {
                    result.Add(new ActivePlayerGameLogDto
                    {
                        PlayerId = log.PlayerId,
                        NhlPlayerId = log.Player!.NhlPlayerId,
                        FirstName = log.Player.FirstName,
                        LastName = log.Player.LastName,
                        GameDate = log.GameDate,
                        Goals = log.Goals,
                        Assists = log.Assists,
                        Points = log.Points,
                        FantasyPoints = log.FantasyPoints
                    });
                }
            }

            // Sort primarily by player last name, then by date ascending
            // so the user can see the timeline of each player's games.
            return result
                .OrderBy(r => r.LastName)
                .ThenBy(r => r.FirstName)
                .ThenBy(r => r.GameDate)
                .ToList();
        }

        private sealed class CardStatLine
        {
            public int PlayerId { get; set; }
            public int Season { get; set; }
            public string LeagueAbbreviation { get; set; } = string.Empty;
            public int GamesPlayed { get; set; }
            public int Goals { get; set; }
            public int Assists { get; set; }
            public int Points { get; set; }
            public int Wins { get; set; }
            public int Losses { get; set; }
            public int OvertimeLosses { get; set; }

            /// <summary>
            /// Hat tricks recorded in the season (from the archive).
            /// Used to derive FP when no live PlayerSeasonStat row
            /// exists for that season — the same way
            /// MarketplaceService does. Null values count as 0.
            /// </summary>
            public int HatTricks { get; set; }

            /// <summary>
            /// Shutouts recorded in the season (from the archive).
            /// Same usage as HatTricks.
            /// </summary>
            public int Shutouts { get; set; }

            /// <summary>
            /// Weighted average ATOI across the group's Sequence
            /// rows, formatted "MM:SS". Null when no row in the
            /// group carried a usable ATOI value, so the frontend
            /// renders a dash instead of a misleading "0:00".
            /// </summary>
            public string? TimeOnIce { get; set; }
        }

        private sealed class RecentGameLogRow
        {
            public int PlayerId { get; set; }
            public DateOnly GameDate { get; set; }
            public int FantasyPoints { get; set; }
        }
    }
}