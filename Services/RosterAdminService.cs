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
        string? note)
        {
            _dbContext.RosterStatusHistories.Add(new RosterStatusHistory
            {
                PlayerId = playerId,
                FantasyTeamId = fantasyTeamId,
                SeasonId = seasonId,
                RosterStatus = status,
                EffectiveAt = effectiveAt,
                CreatedAt = DateTime.UtcNow,
                Note = note
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