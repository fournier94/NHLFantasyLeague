using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Data;
using System.Net.Http;
using NhlFantasyLeague.api.Models.NHL;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlPlayerService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;
        private readonly NhlStatsService _nhlStatsService;
        private readonly NhlTeamService _nhlTeamService;

        public NhlPlayerService(
    HttpClient httpClient,
    AppDbContext dbContext, 
    NhlStatsService nhlStatsService,
    NhlTeamService nhlTeamService)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _nhlStatsService = nhlStatsService;
            _nhlTeamService = nhlTeamService;
        }

        public async Task<NhlPlayerResponse?> GetPlayerAsync(int nhlPlayerId)
        {
            var url = $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/landing";

            return await _httpClient.GetFromJsonAsync<NhlPlayerResponse>(url);
        }

        public async Task<string> GetPlayerRawDataAsync(int nhlPlayerId)
        {
            var url =
                $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/landing";

            return await _httpClient.GetStringAsync(url);
        }

        public async Task<Player?> GetPlayerAsModelAsync(int nhlPlayerId)
        {
            var response = await GetPlayerAsync(nhlPlayerId);

            if (response == null)
            {
                return null;
            }

            DateOnly? birthDate = null;

            if (response.BirthDate.HasValue)
            {
                birthDate = DateOnly.FromDateTime(response.BirthDate.Value);
            }

            return new Player
            {
                NhlPlayerId = response.PlayerId,
                FirstName = response.FirstName.Default,
                LastName = response.LastName.Default,
                Position = response.Position ?? string.Empty,
                NhlTeamId = response.CurrentTeamId,
                BirthDate = birthDate,
                HeadshotUrl = response.Headshot
            };
        }

        public async Task<Player?> SavePlayerAsync(int nhlPlayerId)
        {
            var existingPlayer = await _dbContext.Players
                .FirstOrDefaultAsync(
                    p => p.NhlPlayerId == nhlPlayerId);

            var response = await GetPlayerAsync(
                nhlPlayerId);

            if (response == null)
            {
                return null;
            }

            Player player;

            if (existingPlayer == null)
            {
                player = new Player
                {
                    NhlPlayerId = response.PlayerId,
                    FirstName = response.FirstName.Default,
                    LastName = response.LastName.Default,
                    Position = response.Position ?? string.Empty,
                    NhlTeamId = response.CurrentTeamId,
                    BirthDate = response.BirthDate.HasValue
                        ? DateOnly.FromDateTime(
                            response.BirthDate.Value)
                        : null,
                    HeadshotUrl = response.Headshot
                };

                _dbContext.Players.Add(player);

                await _dbContext.SaveChangesAsync();
            }
            else
            {
                player = existingPlayer;

                player.FirstName =
                    response.FirstName.Default;

                player.LastName =
                    response.LastName.Default;

                player.Position =
                    response.Position ?? string.Empty;

                UpdatePlayerNhlTeam(
                    player,
                    response.CurrentTeamId);

                player.BirthDate =
                    response.BirthDate.HasValue
                        ? DateOnly.FromDateTime(
                            response.BirthDate.Value)
                        : null;

                player.HeadshotUrl =
                    response.Headshot;

                await _dbContext.SaveChangesAsync();
            }

            var stats =
                response.FeaturedStats?
                    .RegularSeason?
                    .SubSeason;

            if (stats != null &&
                response.FeaturedStats != null)
            {
                var season =
                    await _dbContext.Seasons
                        .FirstOrDefaultAsync(
                            s =>
                                s.NhlSeasonCode ==
                                response.FeaturedStats.Season);

                if (season != null)
                {
                    var existingStats =
                        await _dbContext.PlayerSeasonStats
                            .FirstOrDefaultAsync(
                                s =>
                                    s.PlayerId == player.Id &&
                                    s.SeasonId == season.Id);

                    if (existingStats == null)
                    {
                        var playerStats =
                            new PlayerSeasonStat
                            {
                                PlayerId = player.Id,
                                SeasonId = season.Id,
                                GamesPlayed =
                                    stats.GamesPlayed,
                                Goals =
                                    stats.Goals,
                                Assists =
                                    stats.Assists,
                                Points =
                                    stats.Points,
                                Wins =
                                    stats.Wins,
                                OvertimeLosses =
                                    stats.OvertimeLosses,
                                Shutouts =
                                    stats.Shutouts,
                                HatTricks = 0
                            };

                        _dbContext.PlayerSeasonStats
                            .Add(playerStats);
                    }
                    else
                    {
                        existingStats.GamesPlayed =
                            stats.GamesPlayed;

                        existingStats.Goals =
                            stats.Goals;

                        existingStats.Assists =
                            stats.Assists;

                        existingStats.Points =
                            stats.Points;

                        existingStats.Wins =
                            stats.Wins;

                        existingStats.OvertimeLosses =
                            stats.OvertimeLosses;

                        existingStats.Shutouts =
                            stats.Shutouts;
                    }

                    await _dbContext.SaveChangesAsync();
                }
            }

            await _nhlStatsService.SavePlayerSeasonStatsAsync(
                player,
                response.SeasonTotals);

            return player;
        }

        public async Task<NhlPlayerSyncResult> DiscoverPlayerIdsAsync()
        {
            var teams = await _dbContext.NhlTeams
                .ToListAsync();

            if (teams.Count == 0)
            {
                throw new InvalidOperationException(
                    "No NHL teams exist in the database. Sync teams first.");
            }

            var existingPlayerIds = (await _dbContext.Players
                .Select(p => p.NhlPlayerId)
                .ToListAsync())
                .ToHashSet();

            var result = new NhlPlayerSyncResult();

            Console.WriteLine(
                $"[NHL DISCOVERY] Starting player discovery for {teams.Count} NHL teams.");

            foreach (var team in teams)
            {
                Console.WriteLine(
                    $"[NHL DISCOVERY] Processing team {team.Abbreviation} " +
                    $"({result.TeamsProcessed + 1}/{teams.Count})...");

                Console.WriteLine(
                    $"[NHL DISCOVERY] Requesting roster for {team.Abbreviation}...");

                await Task.Delay(TimeSpan.FromSeconds(1));

                var roster = await _nhlTeamService.GetRosterAsync(
                    team.Abbreviation);

                if (roster == null)
                {
                    Console.WriteLine(
                        $"[NHL DISCOVERY] FAILED: Could not retrieve roster for " +
                        $"{team.Abbreviation}.");

                    continue;
                }

                result.TeamsProcessed++;

                var rosterPlayers = roster.Forwards
                    .Concat(roster.Defensemen)
                    .Concat(roster.Goalies)
                    .ToList();

                Console.WriteLine(
                    $"[NHL DISCOVERY] Roster retrieved for {team.Abbreviation}. " +
                    $"Found {rosterPlayers.Count} players.");

                foreach (var rosterPlayer in rosterPlayers)
                {
                    result.PlayersProcessed++;

                    if (existingPlayerIds.Contains(rosterPlayer.Id))
                    {
                        continue;
                    }

                    var player = new Player
                    {
                        NhlPlayerId = rosterPlayer.Id,
                        FirstName = rosterPlayer.FirstName.Default,
                        LastName = rosterPlayer.LastName.Default,
                        Position = rosterPlayer.PositionCode ?? string.Empty,
                        NhlTeamId = team.NhlTeamId,
                        HeadshotUrl = rosterPlayer.Headshot
                    };

                    _dbContext.Players.Add(player);

                    existingPlayerIds.Add(rosterPlayer.Id);

                    result.PlayersAdded++;
                }

                Console.WriteLine(
                    $"[NHL DISCOVERY] Finished {team.Abbreviation}. " +
                    $"Players processed so far: {result.PlayersProcessed}. " +
                    $"Players added so far: {result.PlayersAdded}.");
            }

            Console.WriteLine(
                "[NHL DISCOVERY] Saving discovered players to database...");

            await _dbContext.SaveChangesAsync();

            Console.WriteLine(
                $"[NHL DISCOVERY] COMPLETE. " +
                $"Teams processed: {result.TeamsProcessed}/{teams.Count}. " +
                $"Players processed: {result.PlayersProcessed}. " +
                $"Players added: {result.PlayersAdded}.");

            return result;
        }

        public async Task<Player?> PopulatePlayerFromLandingAsync(int nhlPlayerId)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return null;
            }

            var nhlPlayer = await GetPlayerAsync(nhlPlayerId);

            if (nhlPlayer == null)
            {
                return null;
            }

            player.FirstName = nhlPlayer.FirstName.Default;
            player.LastName = nhlPlayer.LastName.Default;
            player.Position = nhlPlayer.Position ?? string.Empty;

            UpdatePlayerNhlTeam(
                player,
                nhlPlayer.CurrentTeamId);

            player.BirthDate = nhlPlayer.BirthDate.HasValue
                ? DateOnly.FromDateTime(nhlPlayer.BirthDate.Value)
                : null;

            player.BirthCity = nhlPlayer.BirthCity?.Default;
            player.BirthCountry = nhlPlayer.BirthCountry;
            player.HeightInInches = nhlPlayer.HeightInInches;
            player.WeightInPounds = nhlPlayer.WeightInPounds;
            player.ShootsCatches = nhlPlayer.ShootsCatches;
            player.HeroImageUrl = nhlPlayer.HeroImage;
            player.HeadshotUrl = nhlPlayer.Headshot;

            await _dbContext.SaveChangesAsync();

            return player;
        }

        public async Task<NhlPlayerBatchResult> PopulatePlayersFromLandingBatchAsync()
        {
            var playerIds = await _dbContext.Players
                .OrderBy(p => p.Id)
                .Select(p => p.Id)
                .ToListAsync();

            if (playerIds.Count == 0)
            {
                throw new InvalidOperationException(
                    "No players exist in the database. Run player ID discovery first.");
            }

            var result = new NhlPlayerBatchResult
            {
                PlayersProcessed = playerIds.Count
            };

            Console.WriteLine(
                $"[NHL POPULATION] Starting population of {playerIds.Count} players.");

            for (int i = 0; i < playerIds.Count; i++)
            {
                var playerId = playerIds[i];

                Player? player = null;

                Console.WriteLine(
                    $"[NHL POPULATION] Processing player {i + 1}/{playerIds.Count} " +
                    $"(Database Id: {playerId})...");

                try
                {
                    player = await _dbContext.Players
                        .FirstOrDefaultAsync(p => p.Id == playerId);

                    if (player == null)
                    {
                        result.PlayersFailed++;

                        result.FailedPlayers.Add(
                            $"Database Player Id {playerId}: Player not found");

                        Console.WriteLine(
                            $"[NHL POPULATION] FAILED: " +
                            $"Database Player Id {playerId}: Player not found");

                        continue;
                    }

                    Console.WriteLine(
                        $"[NHL POPULATION] NHL Player ID: {player.NhlPlayerId}");

                    var nhlPlayer = await GetPlayerAsync(
                        player.NhlPlayerId);

                    if (nhlPlayer == null)
                    {
                        result.PlayersFailed++;

                        result.FailedPlayers.Add(
                            $"{player.NhlPlayerId} - {player.FirstName} {player.LastName}: " +
                            "NHL API returned no data");

                        Console.WriteLine(
                            $"[NHL POPULATION] FAILED: " +
                            $"NHL ID {player.NhlPlayerId} - NHL API returned no data");

                        continue;
                    }

                    player.FirstName = nhlPlayer.FirstName.Default;
                    player.LastName = nhlPlayer.LastName.Default;
                    player.Position = nhlPlayer.Position ?? string.Empty;

                    UpdatePlayerNhlTeam(
                        player,
                        nhlPlayer.CurrentTeamId);

                    player.BirthDate = nhlPlayer.BirthDate.HasValue
                        ? DateOnly.FromDateTime(
                            nhlPlayer.BirthDate.Value)
                        : null;

                    player.BirthCity =
                        nhlPlayer.BirthCity?.Default;

                    player.BirthCountry =
                        nhlPlayer.BirthCountry;

                    player.HeightInInches =
                        nhlPlayer.HeightInInches;

                    player.WeightInPounds =
                        nhlPlayer.WeightInPounds;

                    player.ShootsCatches =
                        nhlPlayer.ShootsCatches;

                    player.HeroImageUrl =
                        nhlPlayer.HeroImage;

                    player.HeadshotUrl =
                        nhlPlayer.Headshot;

                    Console.WriteLine(
                        $"[NHL POPULATION] Retrieved: " +
                        $"{player.FirstName} {player.LastName} " +
                        $"(NHL ID: {player.NhlPlayerId})");

                    await _nhlStatsService.SyncCareerStatsFromLandingAsync(
                        player,
                        nhlPlayer);

                    Console.WriteLine(
                        $"[NHL POPULATION] Career stats synced for " +
                        $"{player.FirstName} {player.LastName}");

                    await _dbContext.SaveChangesAsync();

                    result.PlayersUpdated++;

                    Console.WriteLine(
                        $"[NHL POPULATION] SUCCESS: " +
                        $"{player.FirstName} {player.LastName} " +
                        $"({i + 1}/{playerIds.Count})");

                    await Task.Delay(
                        TimeSpan.FromSeconds(0.5));
                }
                catch (Exception ex)
                {
                    result.PlayersFailed++;

                    var playerDescription = player == null
                        ? $"Database Player Id {playerId}"
                        : $"{player.NhlPlayerId} - {player.FirstName} {player.LastName}";

                    result.FailedPlayers.Add(
                        $"{playerDescription}: {ex.GetType().Name}: {ex.Message}");

                    Console.WriteLine(
                        $"[NHL POPULATION] FAILED: " +
                        $"{playerDescription}: " +
                        $"{ex.GetType().Name}: {ex.Message}");

                    _dbContext.ChangeTracker.Clear();
                }
            }

            Console.WriteLine(
                $"[NHL POPULATION] COMPLETE. " +
                $"Processed={result.PlayersProcessed}, " +
                $"Updated={result.PlayersUpdated}, " +
                $"Failed={result.PlayersFailed}");

            return result;
        }

        public async Task<List<NhlMissingPlayerResult>> FindMissingPlayersAsync()
        {
            var teams = await _dbContext.NhlTeams
                .ToListAsync();

            if (teams.Count == 0)
            {
                throw new InvalidOperationException(
                    "No NHL teams exist in the database. Sync teams first.");
            }

            var existingPlayerIds = (await _dbContext.Players
    .Select(p => p.NhlPlayerId)
    .ToListAsync())
    .ToHashSet();

            var missingPlayers = new List<NhlMissingPlayerResult>();

            foreach (var team in teams)
            {
                var roster = await _nhlTeamService.GetRosterAsync(team.Abbreviation);

                if (roster == null)
                {
                    continue;
                }

                var rosterPlayers = roster.Forwards
                    .Concat(roster.Defensemen)
                    .Concat(roster.Goalies);

                foreach (var player in rosterPlayers)
                {
                    if (existingPlayerIds.Contains(player.Id))
                    {
                        continue;
                    }

                    missingPlayers.Add(
                        new NhlMissingPlayerResult
                        {
                            NhlPlayerId = player.Id,
                            FirstName = player.FirstName.Default,
                            LastName = player.LastName.Default,
                            Position = player.PositionCode ?? string.Empty,
                            NhlTeamAbbreviation = team.Abbreviation
                        });

                    existingPlayerIds.Add(player.Id);
                }
            }

            return missingPlayers;
        }

        public static void UpdatePlayerNhlTeam(Player player, int? newNhlTeamId)
        {
            if (player.NhlTeamId != newNhlTeamId)
            {
                player.PreviousNhlTeamId = player.NhlTeamId;
                player.NhlTeamId = newNhlTeamId;
            }
        }

        public async Task<Player?> TestUpdatePlayerNhlTeamAsync(int nhlPlayerId, int newNhlTeamId)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
                return null;

            UpdatePlayerNhlTeam(
                player,
                newNhlTeamId);

            await _dbContext.SaveChangesAsync();

            return player;
        }
    }
}
