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

        /// <summary>NHL season code of the previous season (2025-26), used by the player cards.</summary>
        private const int PreviousSeasonNhlCode = 20252026;

        /// <summary>NHL season code of the current season (2026-27), used by the player cards.</summary>
        private const int CurrentSeasonNhlCode = 20262027;

        /// <summary>
        /// Creates the service.
        /// </summary>
        /// <param name="dbContext">Database context used to read and write roster data.</param>
        public RosterAdminService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        /// <summary>
        /// Puts a player on a fantasy team for a season.
        /// </summary>
        /// <param name="request">Team, player, season and optional status, salary and slot.</param>
        /// <returns>Success flag, message and the created roster entry.</returns>
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

            // A player can only be on one fantasy team per season. The unique
            // index (SeasonId, FantasyTeamId, PlayerId) only blocks a duplicate
            // on the SAME team, so the season-wide rule is checked here.
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

            // FantasySalary in the request is ignored - the salary always comes
            // from the player's PlayerContracts.
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

            // Attach the already-loaded player so the result can show his name.
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

        /// <summary>
        /// Moves a player from his current fantasy team to another team in
        /// the same season by updating his roster entry.
        /// </summary>
        /// <param name="request">Player, destination team and optional season.</param>
        /// <returns>Success flag, message and the updated roster entry.</returns>
        public async Task<RosterActionResultDto> MovePlayerAsync(MovePlayerRequest request)
        {
            var season = await ResolveSeasonAsync(request.SeasonId);

            if (season == null)
            {
                return Failure("Season not found. Run POST /api/League/setup first.");
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

            // Capture the old team name before the change (used in the message).
            var oldTeamName = entry.FantasyTeam?.Name ?? $"team {entry.FantasyTeamId}";

            entry.FantasyTeamId = newTeam.Id;

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

        /// <summary>
        /// Releases a player by deleting his roster entry: he becomes a free
        /// agent and can be assigned to any team again later.
        /// </summary>
        /// <param name="request">Id of the roster entry to delete.</param>
        /// <returns>Success flag and message; the entry is null when released.</returns>
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

        /// <summary>
        /// Releases every player currently assigned to a fantasy team for a season,
        /// by deleting all roster entries of that season (full league reset).
        /// </summary>
        /// <param name="request">Optional season id; the current season is used when omitted.</param>
        /// <returns>Success flag and a message with the number of released players.</returns>
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

            // Zero entries means the reset is already done: keep the call idempotent
            // by returning a success instead of an error.
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
        /// Updates the status, the fantasy team or the slot of an existing
        /// roster entry. Only the provided values are changed. The fantasy
        /// salary is always derived from the player's contracts.
        /// </summary>
        /// <param name="request">Entry id plus the values to change.</param>
        /// <returns>Success flag, message and the updated roster entry.</returns>
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

            // A provided FantasyTeamId transfers the player; the same team is a
            // no-op so the "unchanged dropdown" case never fails.
            var teamChanged = false;

            if (request.FantasyTeamId.HasValue &&
                request.FantasyTeamId.Value != entry.FantasyTeamId)
            {
                var targetTeam = await _dbContext.FantasyTeams
                    .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId.Value);

                if (targetTeam == null)
                {
                    return Failure($"Fantasy team {request.FantasyTeamId.Value} not found.");
                }

                // Attach the loaded target team so the result DTO and the
                // success message show the new team, not the old one.
                entry.FantasyTeam = targetTeam;
                entry.FantasyTeamId = targetTeam.Id;
                teamChanged = true;
            }

            // FantasySalary in the request is ignored - the salary always comes
            // from the player's PlayerContracts. Recomputing it on every update
            // makes a previously manual value self-heal.
            entry.FantasySalary = await ResolveSalaryFromContractsAsync(
                entry.PlayerId,
                entry.Season.NhlSeasonCode);

            if (request.RosterSlot.HasValue)
            {
                entry.RosterSlot = request.RosterSlot.Value;
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
        /// the total salary and the number of players per status.
        /// </summary>
        /// <param name="fantasyTeamId">Fantasy team id.</param>
        /// <param name="seasonId">Season id, or null to use the current season.</param>
        /// <returns>The team roster, or null when the team or season does not exist.</returns>
        public async Task<TeamRosterDto?> GetTeamRosterAsync(int fantasyTeamId, int? seasonId)
        {
            var team = await _dbContext.FantasyTeams
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

            // Ordering happens in memory: a team roster is small and this
            // keeps the ordering by enum values, not by the stored text.
            var orderedEntries = entries
                .OrderBy(e => e.RosterStatus)
                .ThenBy(e => e.RosterSlot)
                .ThenBy(e => e.Player.LastName)
                .ToList();

            // Player cards show the previous and the current NHL season. Both
            // seasons and all their stats rows are loaded with one extra query
            // each, then looked up in memory (no per-player query).
            var cardSeasons = await _dbContext.Seasons
                .Where(s =>
                    s.NhlSeasonCode == PreviousSeasonNhlCode ||
                    s.NhlSeasonCode == CurrentSeasonNhlCode)
                .ToListAsync();

            var previousSeason = cardSeasons
                .FirstOrDefault(s => s.NhlSeasonCode == PreviousSeasonNhlCode);
            var currentSeason = cardSeasons
                .FirstOrDefault(s => s.NhlSeasonCode == CurrentSeasonNhlCode);

            var cardSeasonIds = cardSeasons.Select(s => s.Id).ToList();
            var playerIds = entries.Select(e => e.PlayerId).ToList();

            var lastStatsByPlayerId = new Dictionary<int, PlayerSeasonStat>();
            var currentStatsByPlayerId = new Dictionary<int, PlayerSeasonStat>();

            if (cardSeasonIds.Count > 0 && playerIds.Count > 0)
            {
                var stats = await _dbContext.PlayerSeasonStats
                    .Where(s =>
                        cardSeasonIds.Contains(s.SeasonId) &&
                        playerIds.Contains(s.PlayerId))
                    .ToListAsync();

                foreach (var stat in stats)
                {
                    if (previousSeason != null && stat.SeasonId == previousSeason.Id)
                    {
                        lastStatsByPlayerId[stat.PlayerId] = stat;
                    }
                    else if (currentSeason != null && stat.SeasonId == currentSeason.Id)
                    {
                        currentStatsByPlayerId[stat.PlayerId] = stat;
                    }
                }
            }

            // Load every contract of every rostered player in one query, then
            // group them in memory. This replaces the old per-entry salary
            // lookup and also feeds the contract lines on the player cards.
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

            // The FantasySalary column is only a cache of PlayerContracts: recompute
            // it for every entry so rows created when the salary was still entered
            // by hand become consistent (write only when something actually changed).
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

            return new TeamRosterDto
            {
                FantasyTeamId = team.Id,
                FantasyTeamName = team.Name,
                SeasonId = season.Id,
                SeasonName = season.Name,
                TotalPlayers = entries.Count,
                ActiveCount = entries.Count(e => e.RosterStatus == RosterStatus.Active),
                BenchCount = entries.Count(e => e.RosterStatus == RosterStatus.Bench),
                ProspectCount = entries.Count(e => e.RosterStatus == RosterStatus.Prospect),
                TotalSalary = entries.Sum(e => e.FantasySalary),
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

        /// <summary>
        /// Searches players by first or last name (case-insensitive) and shows
        /// the fantasy team that currently holds each player.
        /// </summary>
        /// <param name="search">Text to look for in the first or last name.</param>
        /// <param name="limit">Maximum number of results (1 to 50, default 20).</param>
        /// <returns>The matching players with their current fantasy team, if any.</returns>
        public async Task<List<PlayerSearchResultDto>> SearchPlayersAsync(
            string? search,
            int limit = 20)
        {
            if (string.IsNullOrWhiteSpace(search))
            {
                return new List<PlayerSearchResultDto>();
            }

            var take = Math.Clamp(limit, 1, 50);
            var pattern = $"%{search.Trim()}%";

            var players = await _dbContext.Players
                .Include(p => p.NhlTeam)
                .Where(p =>
                    EF.Functions.ILike(p.FirstName, pattern) ||
                    EF.Functions.ILike(p.LastName, pattern))
                .OrderBy(p => p.LastName)
                .ThenBy(p => p.FirstName)
                .Take(take)
                .ToListAsync();

            // Find each player's current-season roster entry (team + entry fields).
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
                        RosterStatus = entry?.RosterStatus.ToString() // enum → "Active"/"Bench"/"Prospect"
                    };
                })
                .ToList();
        }

        /// <summary>
        /// Resolves the season to work with: the requested one, or the current
        /// season (the one that starts the latest) when none is requested.
        /// </summary>
        /// <param name="seasonId">Requested season id, or null for the current season.</param>
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

        /// <summary>
        /// Parses a roster status text. Null or empty means "Active".
        /// </summary>
        /// <param name="value">Text to parse: "Active", "Bench" or "Prospect".</param>
        /// <param name="status">The parsed status when the method returns true.</param>
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
        /// Builds the failure result used by every operation.
        /// </summary>
        /// <param name="message">Message explaining why the operation failed.</param>
        private static RosterActionResultDto Failure(string message)
        {
            return new RosterActionResultDto
            {
                Success = false,
                Message = message,
                Entry = null
            };
        }

        /// <summary>
        /// Builds the display name of a player.
        /// </summary>
        /// <param name="player">Player to name.</param>
        private static string PlayerName(Player player)
        {
            return $"{player.FirstName} {player.LastName}".Trim();
        }

        /// <summary>
        /// Maps a roster entry (with its player loaded) to its DTO. The two
        /// stat lines and the two contract lines are optional: they are only
        /// provided by the team roster.
        /// </summary>
        /// <param name="entry">Roster entry to map.</param>
        /// <param name="lastSeason">Previous season stat line, or null.</param>
        /// <param name="currentSeason">Current season stat line, or null.</param>
        /// <param name="currentContract">Contract covering the season, or null.</param>
        /// <param name="secondContract">Second contract to display, or null.</param>
        private static RosterEntryDto ToRosterEntryDto(
            RosterEntry entry,
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
                LastSeason = lastSeason,
                CurrentSeason = currentSeason,
                CurrentContract = currentContract,
                SecondContract = secondContract
            };
        }

        /// <summary>
        /// Builds a player-card stat line from a season and one stats row.
        /// Returns null when the season or the stats row is missing, so the
        /// frontend can show a fallback.
        /// </summary>
        /// <param name="season">Season of the stats row, or null when not found.</param>
        /// <param name="stat">Stats row, or null when not found.</param>
        private static SeasonStatLineDto? ToSeasonStatLineDto(
            Season? season,
            PlayerSeasonStat? stat)
        {
            if (season == null || stat == null)
            {
                return null;
            }

            return new SeasonStatLineDto
            {
                // Database season names are "2025-26" / "2026-2027"; the
                // code-based fallback is only used when the name is empty.
                Label = string.IsNullOrWhiteSpace(season.Name)
                    ? $"{season.NhlSeasonCode / 10000}-{season.NhlSeasonCode % 100:D2}"
                    : season.Name,
                NhlSeasonCode = season.NhlSeasonCode,
                GamesPlayed = stat.GamesPlayed,
                Goals = stat.Goals,
                Assists = stat.Assists,
                Points = stat.Points,
                Wins = stat.Wins,
                Losses = stat.Losses,
                OvertimeLosses = stat.OvertimeLosses
            };
        }

        /// <summary>
        /// Computes the fantasy salary of a player from his contracts: 0 $ when
        /// he has no contract, the contract's value when he has exactly one,
        /// otherwise the value of the contract covering the season.
        /// </summary>
        /// <param name="playerId">Database id of the player.</param>
        /// <param name="nhlSeasonCode">NHL season code, for example 20262027.</param>
        /// <param name="ct">Cancellation token.</param>
        /// <returns>The derived salary in dollars, or 0 $ when no contract applies.</returns>
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

        /// <summary>
        /// Computes the salary from an already-loaded contract list: 0 $ with no
        /// contract, the single contract's value with one, otherwise the value of
        /// the contract covering the season (0 $ when none covers it).
        /// </summary>
        /// <param name="contracts">Contracts of one player.</param>
        /// <param name="nhlSeasonCode">NHL season code, for example 20262027.</param>
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

            // Several contracts: only the one covering the season counts; when
            // none covers it (for example only future seasons), there is no salary.
            var coveringContract = contracts.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            return coveringContract?.Salary ?? 0m;
        }

        /// <summary>
        /// Builds the contract lines shown on a player card for a given season:
        /// the contract covering the season first, then the next contract after
        /// it (a "second contract" such as a future extension), if any.
        /// </summary>
        /// <param name="contracts">All contracts of the player.</param>
        /// <param name="nhlSeasonCode">Season the card is displayed for.</param>
        /// <returns>At most two contract lines: current, then second.</returns>
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

            // The contract covering the season, if any.
            var current = ordered.FirstOrDefault(c =>
                c.StartSeason <= nhlSeasonCode &&
                c.EndSeason >= nhlSeasonCode);

            // When no contract covers the season but there is exactly one contract,
            // show it anyway (matches the old single-contract fallback behaviour).
            if (current == null && ordered.Count == 1)
            {
                current = ordered[0];
            }

            // The second contract is the first one starting after the current one
            // (or after the season when there is no current contract).
            var currentEnd = current?.EndSeason ?? nhlSeasonCode;

            var second = ordered
                .Where(c => c.StartSeason > currentEnd)
                .OrderBy(c => c.StartSeason)
                .FirstOrDefault();

            return (
                current == null ? null : ToContractLineDto(current, nhlSeasonCode),
                second == null ? null : ToContractLineDto(second, nhlSeasonCode));
        }

        /// <summary>
        /// Maps a contract to its card line: salary plus the number of seasons
        /// left from the displayed season.
        /// </summary>
        /// <param name="contract">Contract to map.</param>
        /// <param name="nhlSeasonCode">Season the card is displayed for.</param>
        private static PlayerContractLineDto ToContractLineDto(
            PlayerContract contract,
            int nhlSeasonCode)
        {
            // Season codes are 8 digits: 20262027 -> start year 2026.
            var seasonYear = nhlSeasonCode / 10000;
            var startYear = contract.StartSeason / 10000;
            var endYear = contract.EndSeason / 10000;

            // A future contract not yet started still reports its full length.
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
    }
}