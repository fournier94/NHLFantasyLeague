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

        /// <summary>NHL season code of two seasons ago (2024-25), used by the player cards.</summary>
        private const int TwoSeasonsAgoNhlCode = 20242025;

        /// <summary>NHL season code of the previous season (2025-26), used by the player cards.</summary>
        private const int PreviousSeasonNhlCode = 20252026;

        /// <summary>NHL season code of the current season (2026-27), used by the player cards.</summary>
        private const int CurrentSeasonNhlCode = 20262027;

        /// <summary>How many seasons the future cap projection covers, starting with the current one.</summary>
        private const int FutureCapSeasonCount = 5;

        public RosterAdminService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
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

            await _dbContext.SaveChangesAsync();

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

            await _dbContext.SaveChangesAsync();

            return new RosterActionResultDto
            {
                Success = true,
                Message =
                    $"'{PlayerName(entry.Player)}' moved from '{oldTeamName}' " +
                    $"to '{newTeam.Name}' for {season.Name}.",
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

            _dbContext.RosterEntries.Remove(entry);

            await _dbContext.SaveChangesAsync();

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

            _dbContext.RosterEntries.RemoveRange(entries);
            await _dbContext.SaveChangesAsync();

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

            return new RosterActionResultDto
            {
                Success = true,
                Message = $"'{PlayerName(entry.Player!)}' -> {newStatus}.",
                Entry = ToRosterEntryDto(entry)
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

            if (hasStatus)
            {
                if (!TryParseRosterStatus(request.RosterStatus, out var rosterStatus))
                {
                    return Failure(
                        $"Invalid RosterStatus '{request.RosterStatus}'. " +
                        "Use Active, Bench or Prospect.");
                }

                entry.RosterStatus = rosterStatus;
            }

            var teamChanged = false;
            var oldTeamId = entry.FantasyTeamId;
            var oldTeamName = entry.FantasyTeam?.Name ?? $"team {entry.FantasyTeamId}";
            var tradeStatus = entry.RosterStatus;

            if (request.FantasyTeamId.HasValue &&
                request.FantasyTeamId.Value != entry.FantasyTeamId)
            {
                var targetTeam = await _dbContext.FantasyTeams
                    .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId.Value);

                if (targetTeam == null)
                {
                    return Failure($"Fantasy team {request.FantasyTeamId.Value} not found.");
                }

                // Moving a player between fantasy teams is a trade. It
                // needs a valid EffectiveAt so the recompute can slice
                // his FP between the two teams.
                if (request.EffectiveAt == null || request.EffectiveAt == default)
                {
                    return Failure(
                        "EffectiveAt is required when the team changes. " +
                        "Pass the UTC instant the trade becomes effective.");
                }

                entry.FantasyTeam = targetTeam;
                entry.FantasyTeamId = targetTeam.Id;
                teamChanged = true;
            }

            entry.FantasySalary = await ResolveSalaryFromContractsAsync(
                entry.PlayerId,
                entry.Season.NhlSeasonCode);

            if (request.RosterSlot.HasValue)
            {
                entry.RosterSlot = request.RosterSlot.Value;
            }

            // Only write trade history when the team actually changed.
            // Status-only and slot-only updates do not append history:
            // they are covered by the swap / set-status endpoints, which
            // write their own rows. This keeps the audit trail exact.
            if (teamChanged)
            {
                var effectiveAt = NormalizeEffectiveAt(request.EffectiveAt!.Value);

                var note = string.IsNullOrWhiteSpace(request.Note)
                    ? $"Trade from '{oldTeamName}' to '{entry.FantasyTeam?.Name}'"
                    : request.Note!.Trim();

                AddHistoryRow(
                    entry.PlayerId,
                    oldTeamId,
                    entry.SeasonId,
                    tradeStatus,
                    effectiveAt,
                    note);

                AddHistoryRow(
                    entry.PlayerId,
                    entry.FantasyTeamId,
                    entry.SeasonId,
                    tradeStatus,
                    effectiveAt,
                    note);
            }

            await _dbContext.SaveChangesAsync();

            return new RosterActionResultDto
            {
                Success = true,
                Message = teamChanged
                    ? $"'{PlayerName(entry.Player)}' transferred to '{entry.FantasyTeam?.Name}'."
                    : $"'{PlayerName(entry.Player)}' updated on '{entry.FantasyTeam?.Name}'.",
                Entry = ToRosterEntryDto(entry)
            };
        }

        /// <summary>
        /// Returns the full roster of one fantasy team for one season, with
        /// the total salary, the cap salary (Active + Bench), the five-year
        /// cap projection, and the number of players per status.
        ///
        /// The three stat lines shown on each player card come from
        /// PlayerCareerStat (the raw, per-league history), not from
        /// PlayerSeasonStat (which is the fantasy table).
        /// </summary>
        public async Task<TeamRosterDto?> GetTeamRosterAsync(int fantasyTeamId, int? seasonId)
        {
            var team = await _dbContext.FantasyTeams
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
                    .Where(s =>
                        playerIds.Contains(s.PlayerId) &&
                        (s.Season == TwoSeasonsAgoNhlCode ||
                         s.Season == PreviousSeasonNhlCode ||
                         s.Season == CurrentSeasonNhlCode) &&
                        s.GameTypeId == 2)
                    .ToListAsync();
            }

            var leagueLines = careerRows
                .GroupBy(s => new
                {
                    s.PlayerId,
                    s.Season,
                    s.LeagueAbbreviation
                })
                .Select(g => new CardStatLine
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
                    OvertimeLosses = g.Sum(s => s.OvertimeLosses)
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

            var contractsByPlayerId = new Dictionary<int, List<PlayerContract>>();

            if (playerIds.Count > 0)
            {
                var contracts = await _dbContext.PlayerContracts
                    .Where(c => playerIds.Contains(c.PlayerId))
                    .ToListAsync();

                contractsByPlayerId = contracts
                    .GroupBy(c => c.PlayerId)
                    .ToDictionary(g => g.Key, g => g.ToList());
            }

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

                        return ToRosterEntryDto(
                            e,
                            ToSeasonStatLineDto(
                                twoSeasonsAgoSeason,
                                twoSeasonsAgoStatsByPlayerId.GetValueOrDefault(e.PlayerId)),
                            ToSeasonStatLineDto(
                                previousSeason,
                                lastStatsByPlayerId.GetValueOrDefault(e.PlayerId)),
                            ToSeasonStatLineDto(
                                currentSeason,
                                currentStatsByPlayerId.GetValueOrDefault(e.PlayerId)),
                            currentContract,
                            secondContract);
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
                .OrderBy(p => p.LastName)
                .ThenBy(p => p.FirstName)
                .Take(take)
                .ToListAsync();

            var playerIds = players.Select(p => p.Id).ToList();

            var currentSeason = await _dbContext.Seasons
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync();

            var currentEntryByPlayerId = new Dictionary<int, RosterEntry>();

            if (currentSeason != null && playerIds.Count > 0)
            {
                var entries = await _dbContext.RosterEntries
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

        private async Task<Season?> ResolveSeasonAsync(int? seasonId)
        {
            if (seasonId.HasValue)
            {
                return await _dbContext.Seasons
                    .FirstOrDefaultAsync(s => s.Id == seasonId.Value);
            }

            return await _dbContext.Seasons
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync();
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
            PlayerContractLineDto? secondContract = null)
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
                NhlTeamAbbreviation = entry.Player?.NhlTeam?.Abbreviation ?? string.Empty,
                RosterStatus = entry.RosterStatus.ToString(),
                RosterSlot = entry.RosterSlot,
                FantasySalary = entry.FantasySalary,
                HeadshotUrl = entry.Player?.HeadshotUrl,

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
                SecondContract = secondContract
            };
        }

        private static SeasonStatLineDto? ToSeasonStatLineDto(
            Season? season,
            CardStatLine? line)
        {
            if (season == null || line == null)
            {
                return null;
            }

            return new SeasonStatLineDto
            {
                Label = string.IsNullOrWhiteSpace(season.Name)
                    ? $"{season.NhlSeasonCode / 10000}-{season.NhlSeasonCode % 100:D2}"
                    : season.Name,
                NhlSeasonCode = season.NhlSeasonCode,
                LeagueAbbreviation = line.LeagueAbbreviation,
                TeamName = null,
                GameTypeId = 2,
                GamesPlayed = line.GamesPlayed,
                Goals = line.Goals,
                Assists = line.Assists,
                Points = line.Points,
                Wins = line.Wins,
                Losses = line.Losses,
                OvertimeLosses = line.OvertimeLosses
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
                return contracts[0].Salary;
            }

            var coveringContract = contracts.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            return coveringContract?.Salary ?? 0m;
        }

        private static decimal ResolveSalaryForSeason(
            IReadOnlyList<PlayerContract> contracts,
            int nhlSeasonCode)
        {
            var covering = contracts.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            return covering?.Salary ?? 0m;
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
                Salary = contract.Salary,
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
        }
    }
}