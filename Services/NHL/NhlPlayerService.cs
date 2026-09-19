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

            const int limit = 5;
            const int maxAttempts = 5;

            foreach (var team in teams)
            {
                result.TeamsProcessed++;

                int startNumber = 0;
                int currentNumber = 0;
                int totalNumber = 0;

                do
                {
                    var url =
                        $"https://api.nhle.com/stats/rest/en/players" +
                        $"?cayenneExp=currentTeamId%3D{team.NhlTeamId}" +
                        $"&start={startNumber}" +
                        $"&limit={limit}";

                    NhlPlayerIdResponse? response = null;

                    for (int attempt = 1; attempt <= maxAttempts; attempt++)
                    {
                        using var httpResponse = await _httpClient.GetAsync(url);

                        if (httpResponse.IsSuccessStatusCode)
                        {
                            response = await httpResponse.Content
                                .ReadFromJsonAsync<NhlPlayerIdResponse>();

                            break;
                        }

                        if ((int)httpResponse.StatusCode == 429)
                        {
                            await Task.Delay(
                                TimeSpan.FromSeconds(2 * attempt));

                            continue;
                        }

                        httpResponse.EnsureSuccessStatusCode();
                    }

                    if (response == null)
                    {
                        throw new HttpRequestException(
                            $"NHL Stats API request failed after {maxAttempts} attempts.");
                    }

                    totalNumber = response.Total;

                    foreach (var statsPlayer in response.Data)
                    {
                        result.PlayersProcessed++;

                        if (existingPlayerIds.Contains(statsPlayer.Id))
                        {
                            continue;
                        }

                        var player = new Player
                        {
                            NhlPlayerId = statsPlayer.Id
                        };

                        _dbContext.Players.Add(player);

                        existingPlayerIds.Add(statsPlayer.Id);

                        result.PlayersAdded++;
                    }

                    currentNumber = startNumber + response.Data.Count;
                    startNumber = currentNumber;

                    // Small delay between Stats API requests.
                    await Task.Delay(TimeSpan.FromSeconds(0.5));

                } while (currentNumber < totalNumber);
            }

            await _dbContext.SaveChangesAsync();

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

            var result = new NhlPlayerBatchResult
            {
                PlayersProcessed = playerIds.Count
            };

            foreach (var playerId in playerIds)
            {
                Player? player = null;

                try
                {
                    player = await _dbContext.Players
                        .FirstOrDefaultAsync(p => p.Id == playerId);

                    if (player == null)
                    {
                        result.PlayersFailed++;

                        result.FailedPlayers.Add(
                            $"Database Player Id {playerId}: Player not found");

                        continue;
                    }

                    var nhlPlayer = await GetPlayerAsync(
                        player.NhlPlayerId);

                    if (nhlPlayer == null)
                    {
                        result.PlayersFailed++;

                        result.FailedPlayers.Add(
                            $"{player.NhlPlayerId} - {player.FirstName} {player.LastName}: NHL API returned no data");

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

                    await _nhlStatsService.SyncCareerStatsFromLandingAsync(
                        player,
                        nhlPlayer);

                    await _dbContext.SaveChangesAsync();

                    result.PlayersUpdated++;

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

                    _dbContext.ChangeTracker.Clear();
                }
            }

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

        public void UpdatePlayerNhlTeam(Player player, int? newNhlTeamId)
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
