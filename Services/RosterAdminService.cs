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

        /// <summary>
        /// Creates the service.
        /// </summary>
        /// <param name="dbContext">Database context used to read and write roster data.</param>
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

            if (request.FantasyTeamId.HasValue &&
                request.FantasyTeamId.Value != entry.FantasyTeamId)
            {
                var targetTeam = await _dbContext.FantasyTeams
                    .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId.Value);

                if (targetTeam == null)
                {
                    return Failure($"Fantasy team {request.FantasyTeamId.Value} not found.");
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
        ///
        /// The three stat lines shown on each player card come from
        /// PlayerCareerStat (the raw, per-league history), not from
        /// PlayerSeasonStat (which is the fantasy table).
        /// </summary>
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

            // Step 1: sum Sequence rows (mid-season trades) into one line
            // per (player, season, league). Goalie fields are summed too,
            // so a goalie who was traded mid-season gets combined wins,
            // losses and overtime losses.
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

            // Step 2: pick one line per (player, season): NHL first, then
            // most games played. This is what the card shows.
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
                        RosterStatus = entry?.RosterStatus.ToString()
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
                TwoSeasonsAgo = twoSeasonsAgo,
                LastSeason = lastSeason,
                CurrentSeason = currentSeason,
                CurrentContract = currentContract,
                SecondContract = secondContract
            };
        }

        /// <summary>
        /// Builds a player-card stat line from a season and one aggregated
        /// card line. Goalie fields (Wins, Losses, OvertimeLosses) are
        /// carried through for goalies; they stay 0 for skaters, whose
        /// lines only use GamesPlayed / Goals / Assists / Points.
        /// </summary>
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

        /// <summary>
        /// One card line after sequences have been summed: one row per
        /// (player, season, league), already aggregated. Carries both the
        /// skater fields and the goalie fields; the card only displays the
        /// ones matching the player's position.
        /// </summary>
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