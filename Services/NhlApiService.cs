using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Services
{
    public class NhlApiService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public NhlApiService(
            HttpClient httpClient,
            AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
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

        public async Task<List<NhlTeamResponse>> GetTeamsAsync()
        {
            var url = "https://api-web.nhle.com/v1/standings/now";

            var response = await _httpClient
                .GetFromJsonAsync<NhlStandingsResponse>(url);

            if (response == null)
            {
                return new List<NhlTeamResponse>();
            }

            return response.Standings;
        }

        public async Task<NhlPlayerSyncResult> SyncPlayersAsync()
        {
            var teams = await _dbContext.NhlTeams
                .ToListAsync();

            if (teams.Count == 0)
            {
                throw new InvalidOperationException(
                    "No NHL teams exist in the database. Sync teams first.");
            }

            var existingPlayers = await _dbContext.Players
                .ToListAsync();

            var playersByNhlId = existingPlayers
                .ToDictionary(p => p.NhlPlayerId);

            var result = new NhlPlayerSyncResult();

            foreach (var team in teams)
            {
                await Task.Delay(
                    TimeSpan.FromSeconds(1));

                var roster =
                    await GetRosterAsync(
                        team.Abbreviation);

                if (roster == null)
                {
                    continue;
                }

                result.TeamsProcessed++;

                var rosterPlayers = roster.Forwards
                    .Concat(roster.Defensemen)
                    .Concat(roster.Goalies);

                foreach (var rosterPlayer in rosterPlayers)
                {
                    result.PlayersProcessed++;

                    if (!playersByNhlId.TryGetValue(
                            rosterPlayer.Id,
                            out var existingPlayer))
                    {
                        existingPlayer = new Player
                        {
                            NhlPlayerId = rosterPlayer.Id,
                            FirstName =
                                rosterPlayer.FirstName.Default,
                            LastName =
                                rosterPlayer.LastName.Default,
                            Position =
                                rosterPlayer.PositionCode ?? string.Empty,
                            NhlTeamId =
                                team.NhlTeamId,
                            HeadshotUrl =
                                rosterPlayer.Headshot
                        };

                        _dbContext.Players.Add(
                            existingPlayer);

                        playersByNhlId.Add(
                            rosterPlayer.Id,
                            existingPlayer);

                        result.PlayersAdded++;
                    }
                    else
                    {
                        bool changed = false;

                        var firstName =
                            rosterPlayer.FirstName.Default;

                        var lastName =
                            rosterPlayer.LastName.Default;

                        var position =
                            rosterPlayer.PositionCode ??
                            string.Empty;

                        var headshotUrl =
                            rosterPlayer.Headshot;

                        if (existingPlayer.FirstName != firstName)
                        {
                            existingPlayer.FirstName =
                                firstName;

                            changed = true;
                        }

                        if (existingPlayer.LastName != lastName)
                        {
                            existingPlayer.LastName =
                                lastName;

                            changed = true;
                        }

                        if (existingPlayer.Position != position)
                        {
                            existingPlayer.Position =
                                position;

                            changed = true;
                        }

                        if (existingPlayer.NhlTeamId !=
                            team.NhlTeamId)
                        {
                            UpdatePlayerNhlTeam(
                                existingPlayer,
                                team.NhlTeamId);

                            changed = true;
                        }

                        if (existingPlayer.HeadshotUrl !=
                            headshotUrl)
                        {
                            existingPlayer.HeadshotUrl =
                                headshotUrl;

                            changed = true;
                        }

                        if (changed)
                        {
                            result.PlayersUpdated++;
                        }
                    }
                }
            }

            await _dbContext.SaveChangesAsync();

            return result;
        }

        public async Task<List<NhlTeamMetadata>> GetTeamMetadataAsync()
        {
            var url = "https://api.nhle.com/stats/rest/en/team";

            var response = await _httpClient
                .GetFromJsonAsync<NhlTeamMetadataResponse>(url);

            if (response == null)
            {
                return new List<NhlTeamMetadata>();
            }

            return response.Data;
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

        public async Task<List<NhlTeam>> SyncTeamsAsync()
        {
            // Get the current NHL teams.
            var currentTeams = await GetTeamsAsync();

            // Get NHL team metadata, which contains numeric team IDs.
            var teamMetadata = await GetTeamMetadataAsync();

            if (currentTeams.Count == 0)
            {
                throw new InvalidOperationException(
                    "The NHL current standings endpoint returned no teams.");
            }

            if (teamMetadata.Count == 0)
            {
                throw new InvalidOperationException(
                    "The NHL team metadata endpoint returned no teams.");
            }

            // Create a lookup:
            // Montreal abbreviation -> numeric NHL team ID
            var metadataByAbbreviation = teamMetadata
                .Where(t => !string.IsNullOrWhiteSpace(t.TriCode))
                .GroupBy(t => t.TriCode)
                .ToDictionary(
                    g => g.Key,
                    g => g.First());

            // Convert the current NHL teams into records containing
            // both the current-team information and the numeric ID.
            var teamsToSync = new List<(int TeamId, string Name, string Abbreviation, string? LogoUrl)>();

            foreach (var currentTeam in currentTeams)
            {
                var abbreviation = currentTeam.TeamAbbrev.Default;

                if (!metadataByAbbreviation.TryGetValue(
                    abbreviation,
                    out var metadata))
                {
                    throw new InvalidOperationException(
                        $"Could not find NHL team metadata for abbreviation '{abbreviation}'.");
                }

                teamsToSync.Add(
                    (
                        metadata.Id,
                        currentTeam.TeamName.Default,
                        abbreviation,
                        currentTeam.TeamLogo
                    ));
            }

            var currentNhlTeamIds = teamsToSync
                .Select(t => t.TeamId)
                .ToHashSet();

            // Load the teams currently in our database.
            var existingTeams = await _dbContext.NhlTeams
                .ToListAsync();

            // Remove teams that are not part of the current NHL.
            //
            // This removes historical teams such as the Quebec Nordiques
            // if they exist from an earlier test.
            foreach (var existingTeam in existingTeams)
            {
                if (!currentNhlTeamIds.Contains(existingTeam.NhlTeamId))
                {
                    _dbContext.NhlTeams.Remove(existingTeam);
                }
            }

            // Save deletions before inserting/updating current teams.
            await _dbContext.SaveChangesAsync();

            // Reload the database after deletions.
            existingTeams = await _dbContext.NhlTeams
                .ToListAsync();

            var savedTeams = new List<NhlTeam>();

            foreach (var team in teamsToSync)
            {
                var existingTeam = existingTeams
                    .FirstOrDefault(t => t.NhlTeamId == team.TeamId);

                if (existingTeam == null)
                {
                    existingTeam = new NhlTeam
                    {
                        NhlTeamId = team.TeamId,
                        Name = team.Name,
                        Abbreviation = team.Abbreviation,
                        LogoUrl = team.LogoUrl
                    };

                    _dbContext.NhlTeams.Add(existingTeam);
                }
                else
                {
                    existingTeam.Name = team.Name;
                    existingTeam.Abbreviation = team.Abbreviation;
                    existingTeam.LogoUrl = team.LogoUrl;
                }

                savedTeams.Add(existingTeam);
            }

            await _dbContext.SaveChangesAsync();

            return savedTeams;
        }

        public async Task<Player?> SavePlayerAsync(
    int nhlPlayerId)
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

            await SavePlayerSeasonStatsAsync(
                player,
                response.SeasonTotals);

            return player;
        }

        public async Task<int> SavePlayerSeasonStatsAsync(
            Player player,
            List<NhlSeasonTotal> seasonTotals)
        {
            var nhlSeasons = seasonTotals
                .Where(s =>
                    s.LeagueAbbrev == "NHL" &&
                    s.GameTypeId == 2)
                .ToList();

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            var savedCount = 0;

            foreach (var stats in nhlSeasons)
            {
                var season = await _dbContext.Seasons
                    .FirstOrDefaultAsync(s =>
                        s.NhlSeasonCode == stats.Season);

                if (season == null)
                {
                    var seasonStartYear = stats.Season / 10000;
                    var seasonEndYear = stats.Season % 10000;

                    season = new Season
                    {
                        Name = $"{seasonStartYear}-{(seasonEndYear % 100).ToString("D2")}",
                        StartDate = new DateOnly(seasonStartYear, 10, 1),
                        EndDate = new DateOnly(seasonEndYear, 6, 30),
                        SalaryCap = 0,
                        SalaryFloor = 0,
                        NhlSeasonCode = stats.Season,
                        LeagueId = 1
                    };

                    _dbContext.Seasons.Add(season);

                    await _dbContext.SaveChangesAsync();
                }

                // NHL seasonTotals provides a Points value for skaters.
                // For goalies, the NHL response does not provide a Points field,
                // so we calculate points from their goals and assists.
                int points = isGoalie
                    ? stats.Goals + stats.Assists
                    : stats.Points;

                var existingStats = await _dbContext.PlayerSeasonStats
                    .FirstOrDefaultAsync(s =>
                        s.PlayerId == player.Id &&
                        s.SeasonId == season.Id);

                if (existingStats == null)
                {
                    var playerStats = new PlayerSeasonStat
                    {
                        PlayerId = player.Id,
                        SeasonId = season.Id,
                        GamesPlayed = stats.GamesPlayed,
                        Goals = stats.Goals,
                        Assists = stats.Assists,
                        Points = points,
                        PlusMinus = stats.PlusMinus,
                        PenaltyMinutes = stats.PenaltyMinutes,
                        PowerPlayGoals = stats.PowerPlayGoals,
                        PowerPlayPoints = stats.PowerPlayPoints,
                        GameWinningGoals = stats.GameWinningGoals,
                        Shots = stats.Shots,
                        ShootingPercentage = stats.ShootingPercentage,
                        GoalsAgainst = stats.GoalsAgainst,
                        Wins = stats.Wins,
                        Losses = stats.Losses,
                        OvertimeLosses = stats.OvertimeLosses,
                        Shutouts = stats.Shutouts,
                        HatTricks = 0,
                        Saves = stats.ShotsAgainst - stats.GoalsAgainst,
                        ShotsAgainst = stats.ShotsAgainst,
                        SavePercentage = stats.SavePercentage,
                        GoalsAgainstAverage = stats.GoalsAgainstAverage
                    };

                    _dbContext.PlayerSeasonStats.Add(playerStats);
                    savedCount++;
                }
                else
                {
                    existingStats.GamesPlayed = stats.GamesPlayed;
                    existingStats.Goals = stats.Goals;
                    existingStats.Assists = stats.Assists;
                    existingStats.Points = points;
                    existingStats.PlusMinus = stats.PlusMinus;
                    existingStats.PenaltyMinutes = stats.PenaltyMinutes;
                    existingStats.PowerPlayGoals = stats.PowerPlayGoals;
                    existingStats.PowerPlayPoints = stats.PowerPlayPoints;
                    existingStats.GameWinningGoals = stats.GameWinningGoals;
                    existingStats.Shots = stats.Shots;
                    existingStats.ShootingPercentage = stats.ShootingPercentage;
                    existingStats.GoalsAgainst = stats.GoalsAgainst;
                    existingStats.Wins = stats.Wins;
                    existingStats.Losses = stats.Losses;
                    existingStats.OvertimeLosses = stats.OvertimeLosses;
                    existingStats.Shutouts = stats.Shutouts;
                    existingStats.Saves = stats.ShotsAgainst - stats.GoalsAgainst;
                    existingStats.ShotsAgainst = stats.ShotsAgainst;
                    existingStats.SavePercentage = stats.SavePercentage;
                    existingStats.GoalsAgainstAverage = stats.GoalsAgainstAverage;
                }
            }

            await _dbContext.SaveChangesAsync();

            return savedCount;
        }

        public async Task<NhlRosterResponse?> GetRosterAsync(string teamAbbreviation)
        {
            var url = $"https://api-web.nhle.com/v1/roster/{teamAbbreviation}/current";

            for (int attempt = 1; attempt <= 3; attempt++)
            {
                using var response = await _httpClient.GetAsync(url);

                if (response.IsSuccessStatusCode)
                {
                    return await response.Content
                        .ReadFromJsonAsync<NhlRosterResponse>();
                }

                if ((int)response.StatusCode == 429)
                {
                    await Task.Delay(TimeSpan.FromSeconds(3 * attempt));
                    continue;
                }

                return null;
            }

            return null;
        }

        public async Task<NhlPlayerGameLogResponse?> GetPlayerGameLogAsync(
    int nhlPlayerId,
    int seasonCode)
        {
            var url =
                $"https://api-web.nhle.com/v1/player/{nhlPlayerId}/game-log/{seasonCode}/2";

            return await _httpClient.GetFromJsonAsync<NhlPlayerGameLogResponse>(url);
        }


        public async Task<int> SavePlayerGameLogsAsync(
            int nhlPlayerId,
            int seasonCode)
        {
            var playerResponse = await GetPlayerAsync(nhlPlayerId);

            if (playerResponse == null)
            {
                return 0;
            }

            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                player = await SavePlayerAsync(nhlPlayerId);
            }

            if (player == null)
            {
                return 0;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return 0;
            }

            var gameLogResponse =
                await GetPlayerGameLogAsync(nhlPlayerId, seasonCode);

            if (gameLogResponse == null)
            {
                return 0;
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            // Load NHL teams once instead of querying the database
            // for every individual game.
            var teams = await _dbContext.NhlTeams
                .ToListAsync();

            var teamsByAbbreviation = teams
                .ToDictionary(
                    t => t.Abbreviation,
                    StringComparer.OrdinalIgnoreCase);

            // Load all existing game logs for this player/season once.
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
                    // Goalies can receive points from goals/assists,
                    // but never receive a hat-trick bonus.
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
                    // Only skaters can receive a hat-trick bonus.
                    hatTrick = game.Goals >= 3;
                }

                // The NHL game-log response does not provide the
                // "points" field for goalies. Calculate it from
                // goals + assists instead.
                int points = isGoalie
                    ? game.Goals + game.Assists
                    : game.Points;

                int fantasyPoints = points;

                if (hatTrick)
                {
                    fantasyPoints += 2;
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
                    fantasyPoints += 1;
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
                        HatTrick = hatTrick,
                        GoalieWin = goalieWin,
                        GoalieOvertimeLoss = goalieOTLoss,
                        Shutout = shutout,
                        GoalsAgainst = game.GoalsAgainst,
                        ShotsAgainst = game.ShotsAgainst,
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
                    existingLog.HatTrick = hatTrick;
                    existingLog.GoalieWin = goalieWin;
                    existingLog.GoalieOvertimeLoss = goalieOTLoss;
                    existingLog.Shutout = shutout;
                    existingLog.GoalsAgainst = game.GoalsAgainst;
                    existingLog.ShotsAgainst = game.ShotsAgainst;
                    existingLog.FantasyPoints = fantasyPoints;
                }
            }

            await _dbContext.SaveChangesAsync();

            // Recalculate fantasy-specific season statistics
            // after inserting/updating the game logs.
            await UpdatePlayerSeasonStatsAsync(
                nhlPlayerId,
                seasonCode);

            return savedCount;
        }

        public async Task UpdatePlayerSeasonStatsAsync(
    int nhlPlayerId,
    int seasonCode)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return;
            }

            var logs = await _dbContext.PlayerGameLogs
                .Where(g =>
                    g.PlayerId == player.Id &&
                    g.SeasonId == season.Id)
                .ToListAsync();

            if (logs.Count == 0)
            {
                return;
            }

            var seasonStats = await _dbContext.PlayerSeasonStats
                .FirstOrDefaultAsync(s =>
                    s.PlayerId == player.Id &&
                    s.SeasonId == season.Id);

            if (seasonStats == null)
            {
                seasonStats = new PlayerSeasonStat
                {
                    PlayerId = player.Id,
                    SeasonId = season.Id
                };

                _dbContext.PlayerSeasonStats.Add(seasonStats);
            }

            bool isGoalie =
                string.Equals(
                    player.Position,
                    "G",
                    StringComparison.OrdinalIgnoreCase);

            // Fantasy points are calculated from the individual game logs.
            seasonStats.FantasyPoints =
                logs.Sum(g => g.FantasyPoints);

            // Hat-tricks are calculated from game logs because
            // NHL season totals do not provide a hat-trick count.
            // Goalies can never receive a hat-trick bonus.
            if (!isGoalie)
            {
                seasonStats.HatTricks =
                    logs.Count(g => g.HatTrick);
            }
            else
            {
                seasonStats.HatTricks = 0;
            }

            await _dbContext.SaveChangesAsync();
        }

        public async Task<PlayerSeasonStat?> GetPlayerSeasonStatsAsync(
int nhlPlayerId,
int seasonCode)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return null;
            }

            var season = await _dbContext.Seasons
                .FirstOrDefaultAsync(s => s.NhlSeasonCode == seasonCode);

            if (season == null)
            {
                return null;
            }

            return await _dbContext.PlayerSeasonStats
                .FirstOrDefaultAsync(s =>
                    s.PlayerId == player.Id &&
                    s.SeasonId == season.Id);
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
                var roster = await GetRosterAsync(team.Abbreviation);

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

        public async Task<Player?> PopulatePlayerFromLandingAsync(
    int nhlPlayerId)
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

                    await SyncCareerStatsFromLandingAsync(
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

        public async Task<List<PlayerCareerStat>> SyncPlayerCareerStatsAsync(int nhlPlayerId)
        {
            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            if (player == null)
            {
                return new List<PlayerCareerStat>();
            }

            var nhlPlayer = await GetPlayerAsync(nhlPlayerId);

            if (nhlPlayer == null)
            {
                return new List<PlayerCareerStat>();
            }

            var existingStats = await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .ToDictionaryAsync(
                    s => (s.Season, s.GameTypeId, s.Sequence));

            var apiKeys = nhlPlayer.SeasonTotals
                .Select(s => (s.Season, s.GameTypeId, s.Sequence))
                .ToHashSet();

            foreach (var stats in nhlPlayer.SeasonTotals)
            {
                var key = (
                    stats.Season,
                    stats.GameTypeId,
                    stats.Sequence);

                if (!existingStats.TryGetValue(
                        key,
                        out var careerStat))
                {
                    careerStat = new PlayerCareerStat
                    {
                        PlayerId = player.Id,
                        Season = stats.Season,
                        GameTypeId = stats.GameTypeId,
                        Sequence = stats.Sequence
                    };

                    _dbContext.PlayerCareerStats.Add(careerStat);

                    existingStats[key] = careerStat;
                }

                careerStat.LeagueAbbreviation = stats.LeagueAbbrev;
                careerStat.TeamName = stats.TeamName?.Default;

                careerStat.GamesPlayed = stats.GamesPlayed;
                careerStat.GamesStarted = stats.GamesStarted;

                careerStat.Goals = stats.Goals;
                careerStat.Assists = stats.Assists;
                careerStat.Points = stats.Points;

                careerStat.PlusMinus = stats.PlusMinus;
                careerStat.PenaltyMinutes = stats.PenaltyMinutes;

                careerStat.PowerPlayGoals = stats.PowerPlayGoals;
                careerStat.PowerPlayPoints = stats.PowerPlayPoints;

                careerStat.ShorthandedGoals = stats.ShorthandedGoals;
                careerStat.ShorthandedPoints = stats.ShorthandedPoints;

                careerStat.GameWinningGoals = stats.GameWinningGoals;
                careerStat.OvertimeGoals = stats.OvertimeGoals;

                careerStat.Shots = stats.Shots;
                careerStat.ShootingPercentage = stats.ShootingPercentage;

                careerStat.AverageTimeOnIce = stats.AverageTimeOnIce;
                careerStat.FaceoffWinningPercentage =
                    stats.FaceoffWinningPercentage;

                careerStat.Wins = stats.Wins;
                careerStat.Losses = stats.Losses;
                careerStat.OvertimeLosses = stats.OvertimeLosses;
                careerStat.Shutouts = stats.Shutouts;

                careerStat.Saves = stats.Saves;
                careerStat.ShotsAgainst = stats.ShotsAgainst;
                careerStat.SavePercentage = stats.SavePercentage;

                careerStat.GoalsAgainst = stats.GoalsAgainst;
                careerStat.GoalsAgainstAverage =
                    stats.GoalsAgainstAverage;
            }

            foreach (var existingStat in existingStats.Values)
            {
                var stillExists = apiKeys.Contains(
                    (
                        existingStat.Season,
                        existingStat.GameTypeId,
                        existingStat.Sequence
                    ));

                if (!stillExists)
                {
                    _dbContext.PlayerCareerStats.Remove(existingStat);
                }
            }

            await _dbContext.SaveChangesAsync();

            return await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .OrderBy(s => s.Season)
                .ThenBy(s => s.GameTypeId)
                .ThenBy(s => s.Sequence)
                .ToListAsync();
        }

        private async Task SyncCareerStatsFromLandingAsync(
    Player player,
    NhlPlayerResponse nhlPlayer)
        {
            var existingStats = await _dbContext.PlayerCareerStats
                .Where(s => s.PlayerId == player.Id)
                .ToDictionaryAsync(
                    s => (s.Season, s.GameTypeId, s.Sequence));

            var apiKeys = nhlPlayer.SeasonTotals
                .Select(s => (s.Season, s.GameTypeId, s.Sequence))
                .ToHashSet();

            foreach (var stats in nhlPlayer.SeasonTotals)
            {
                var key = (
                    stats.Season,
                    stats.GameTypeId,
                    stats.Sequence);

                if (!existingStats.TryGetValue(
                        key,
                        out var careerStat))
                {
                    careerStat = new PlayerCareerStat
                    {
                        PlayerId = player.Id,
                        Season = stats.Season,
                        GameTypeId = stats.GameTypeId,
                        Sequence = stats.Sequence
                    };

                    _dbContext.PlayerCareerStats.Add(careerStat);

                    existingStats[key] = careerStat;
                }

                careerStat.LeagueAbbreviation = stats.LeagueAbbrev;
                careerStat.TeamName = stats.TeamName?.Default;

                careerStat.GamesPlayed = stats.GamesPlayed;
                careerStat.GamesStarted = stats.GamesStarted;

                careerStat.Goals = stats.Goals;
                careerStat.Assists = stats.Assists;
                careerStat.Points = stats.Points;

                careerStat.PlusMinus = stats.PlusMinus;
                careerStat.PenaltyMinutes = stats.PenaltyMinutes;

                careerStat.PowerPlayGoals = stats.PowerPlayGoals;
                careerStat.PowerPlayPoints = stats.PowerPlayPoints;

                careerStat.ShorthandedGoals = stats.ShorthandedGoals;
                careerStat.ShorthandedPoints = stats.ShorthandedPoints;

                careerStat.GameWinningGoals = stats.GameWinningGoals;
                careerStat.OvertimeGoals = stats.OvertimeGoals;

                careerStat.Shots = stats.Shots;
                careerStat.ShootingPercentage = stats.ShootingPercentage;

                careerStat.AverageTimeOnIce = stats.AverageTimeOnIce;
                careerStat.FaceoffWinningPercentage =
                    stats.FaceoffWinningPercentage;

                careerStat.Wins = stats.Wins;
                careerStat.Losses = stats.Losses;
                careerStat.OvertimeLosses = stats.OvertimeLosses;
                careerStat.Shutouts = stats.Shutouts;

                careerStat.Saves = stats.Saves;
                careerStat.ShotsAgainst = stats.ShotsAgainst;
                careerStat.SavePercentage = stats.SavePercentage;

                careerStat.GoalsAgainst = stats.GoalsAgainst;
                careerStat.GoalsAgainstAverage =
                    stats.GoalsAgainstAverage;
            }

            foreach (var existingStat in existingStats.Values)
            {
                var stillExists = apiKeys.Contains(
                    (
                        existingStat.Season,
                        existingStat.GameTypeId,
                        existingStat.Sequence
                    ));

                if (!stillExists)
                {
                    _dbContext.PlayerCareerStats.Remove(existingStat);
                }
            }
        }

        private void UpdatePlayerNhlTeam(
    Player player,
    int? newNhlTeamId)
        {
            if (player.NhlTeamId != newNhlTeamId)
            {
                player.PreviousNhlTeamId = player.NhlTeamId;
                player.NhlTeamId = newNhlTeamId;
            }
        }

        public async Task<string> GetCapFreezeTeamPageAsync(string teamSlug)
        {
            var url = $"https://capfreeze.com/teams/{teamSlug}.html";

            return await _httpClient.GetStringAsync(url);
        }

        public async Task<string> GetCapFreezePlayerPageAsync(
    string playerSlug)
        {
            var url =
                $"https://capfreeze.com/players/{playerSlug}.html";

            return await _httpClient.GetStringAsync(url);
        }

        private int? ExtractContractYears(
    string html,
    string playerName)
        {
            var text = System.Net.WebUtility.HtmlDecode(html);

            var nameYrCount = System.Text.RegularExpressions.Regex
                .Matches(
                    playerName,
                    @"yr",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase)
                .Count;

            var yrMatches = System.Text.RegularExpressions.Regex
                .Matches(
                    text,
                    @"\byr\b",
                    System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            var targetIndex = nameYrCount;

            if (targetIndex >= yrMatches.Count)
                return null;

            var yrMatch = yrMatches[targetIndex];

            var textBeforeYr = text[..yrMatch.Index];

            var numberMatch = System.Text.RegularExpressions.Regex.Match(
                textBeforeYr,
                @"(\d+)\s*$");

            if (!numberMatch.Success)
                return null;

            if (!int.TryParse(
                    numberMatch.Groups[1].Value,
                    out var years))
            {
                return null;
            }

            return years;
        }

        public async Task<decimal?> TestExtractCapHitAsync(
    string teamSlug,
    string playerSlug,
    int season)
        {
            var teamUrl =
                $"https://capfreeze.com/teams/{teamSlug}.html";

            var html = await _httpClient.GetStringAsync(teamUrl);

            var playerMarker =
                $"../players/{playerSlug}.html";

            var playerIndex = html.IndexOf(
                playerMarker,
                StringComparison.OrdinalIgnoreCase);

            if (playerIndex == -1)
                return null;

            var nextTableEnd = html.IndexOf(
                "</tr>",
                playerIndex,
                StringComparison.OrdinalIgnoreCase);

            if (nextTableEnd == -1)
                return null;

            var row = html[playerIndex..nextTableEnd];

            var pattern =
                $@"data-season=""{season}""[^>]*data-cap=""(\d+(?:\.\d+)?)""";

            var match = System.Text.RegularExpressions.Regex.Match(
                row,
                pattern,
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            if (!match.Success)
                return null;

            if (!decimal.TryParse(
                    match.Groups[1].Value,
                    out var capHit))
            {
                return null;
            }

            return capHit;
        }

        public List<decimal> TestExtractCapHitsFromRow()
        {
            var row = """
        <tr><td><a href="../players/ivan-demidov.html">Ivan Demidov</a></td><td>RW</td>
        <td class="num" data-v="20">20</td>
        <td class="num moneycell" data-cap="940833" data-cash="975000" data-v="940833">$940,833</td><td class="num moneycell" data-cap="9150000" data-cash="12500000" data-v="9150000">$9,150,000</td><td class="num moneycell" data-cap="9150000" data-cash="12500000" data-v="9150000">$9,150,000</td><td class="num moneycell" data-cap="9150000" data-cash="10500000" data-v="9150000">$9,150,000</td><td class="num moneycell" data-cap="9150000" data-cash="7700000" data-v="9150000">$9,150,000</td>
        <td class="num" data-v="0.00905">0.9%</td></tr>
        """;

            var matches = System.Text.RegularExpressions.Regex.Matches(
                row,
                @"<td[^>]*class=""[^""]*moneycell[^""]*""[^>]*data-cap=""(\d+(?:\.\d+)?)""",
                System.Text.RegularExpressions.RegexOptions.IgnoreCase);

            var capHits = new List<decimal>();

            foreach (System.Text.RegularExpressions.Match match in matches)
            {
                if (decimal.TryParse(
                        match.Groups[1].Value,
                        out var capHit))
                {
                    capHits.Add(capHit);
                }
            }

            return capHits;
        }

        public List<string> ExtractCapFreezeSectionPlayers(
    string html,
    string sectionName)
        {
            var document = new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            var sectionHeader = document.DocumentNode
                .SelectSingleNode(
                    $"//h2[contains(normalize-space(), '{sectionName}')]");

            if (sectionHeader == null)
                return new List<string>();

            var players = new List<string>();

            var table = sectionHeader
                .SelectSingleNode("following-sibling::table[1]");

            if (table == null)
                return players;

            var rows = table.SelectNodes(".//tr");

            if (rows == null)
                return players;

            foreach (var row in rows)
            {
                var playerLink = row.SelectSingleNode(".//a");

                if (playerLink == null)
                    continue;

                var playerName = System.Net.WebUtility.HtmlDecode(
                    playerLink.InnerText.Trim());

                if (!string.IsNullOrWhiteSpace(playerName))
                    players.Add(playerName);
            }

            return players;
        }

        private string NormalizePlayerName(string name)
        {
            var normalized = name
                .Normalize(
                    System.Text.NormalizationForm.FormD);

            var characters = normalized
                .Where(c =>
                    System.Globalization.CharUnicodeInfo
                        .GetUnicodeCategory(c)
                    != System.Globalization.UnicodeCategory.NonSpacingMark)
                .ToArray();

            return new string(characters)
                .Normalize(
                    System.Text.NormalizationForm.FormC)
                .ToLowerInvariant()
                .Replace("-", "")
                .Replace("'", "")
                .Replace(" ", "");
        }

        private double CalculateSimilarity(
    string first,
    string second)
        {
            if (first == second)
                return 1.0;

            var distance = LevenshteinDistance(
                first,
                second);

            var maxLength =
                Math.Max(first.Length, second.Length);

            if (maxLength == 0)
                return 1.0;

            return 1.0 -
                   ((double)distance / maxLength);
        }

        private int LevenshteinDistance(
    string first,
    string second)
        {
            var matrix =
                new int[first.Length + 1, second.Length + 1];

            for (var i = 0; i <= first.Length; i++)
                matrix[i, 0] = i;

            for (var j = 0; j <= second.Length; j++)
                matrix[0, j] = j;

            for (var i = 1; i <= first.Length; i++)
            {
                for (var j = 1; j <= second.Length; j++)
                {
                    var cost =
                        first[i - 1] == second[j - 1]
                            ? 0
                            : 1;

                    matrix[i, j] = Math.Min(
                        Math.Min(
                            matrix[i - 1, j] + 1,
                            matrix[i, j - 1] + 1),
                        matrix[i - 1, j - 1] + cost);
                }
            }

            return matrix[
                first.Length,
                second.Length];
        }

        public async Task<Player?> FindPlayerByCapFreezeNameAsync(
    string capFreezeName)
        {
            var normalizedName =
                NormalizePlayerName(capFreezeName);

            var players = await _dbContext.Players
                .Where(p => p.CapFreezeName != null)
                .ToListAsync();

            return players.FirstOrDefault(p =>
                NormalizePlayerName(p.CapFreezeName!) == normalizedName);
        }

        public async Task<string> TestFindTeamPlayerMatchesAsync(
    string capFreezeName,
    int nhlTeamId)
        {
            var players = await _dbContext.Players
                .Where(p =>
                    p.NhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            if (players.Count == 0)
                return "No players found for this NHL team.";

            var parts = capFreezeName
                .Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 2)
                return "Could not split player name.";

            var capFreezeFirstName = parts[0];

            var capFreezeLastName = string.Join(
                " ",
                parts.Skip(1));

            var normalizedCapFreezeFirstName =
                NormalizePlayerName(capFreezeFirstName);

            var normalizedCapFreezeLastName =
                NormalizePlayerName(capFreezeLastName);

            var normalizedCapFreezeFullName =
                NormalizePlayerName(capFreezeName);

            var matches = players
                .Select(player =>
                {
                    var normalizedDatabaseFirstName =
                        NormalizePlayerName(player.FirstName);

                    var normalizedDatabaseLastName =
                        NormalizePlayerName(player.LastName);

                    var normalizedDatabaseFullName =
                        NormalizePlayerName(
                            $"{player.FirstName} {player.LastName}");

                    return new
                    {
                        player.Id,
                        player.NhlPlayerId,
                        player.FirstName,
                        player.LastName,
                        player.NhlTeamId,

                        FirstNameSimilarity =
                            CalculateSimilarity(
                                normalizedCapFreezeFirstName,
                                normalizedDatabaseFirstName),

                        LastNameSimilarity =
                            CalculateSimilarity(
                                normalizedCapFreezeLastName,
                                normalizedDatabaseLastName),

                        FullNameSimilarity =
                            CalculateSimilarity(
                                normalizedCapFreezeFullName,
                                normalizedDatabaseFullName)
                    };
                })
                .OrderByDescending(x => x.FullNameSimilarity)
                .ThenByDescending(x => x.LastNameSimilarity)
                .ThenByDescending(x => x.FirstNameSimilarity)
                .Take(5)
                .ToList();

            return System.Text.Json.JsonSerializer.Serialize(
                new
                {
                    CapFreezeName = capFreezeName,
                    NhlTeamId = nhlTeamId,
                    CandidateCount = players.Count,
                    Matches = matches
                });
        }

        public async Task<Player?> FindAndRecordCapFreezePlayerMatchAsync(
    string capFreezeName,
    string capFreezePosition,
    int nhlTeamId,
    bool saveChanges = true,
    List<Player>? currentTeamPlayers = null,
    List<Player>? previousTeamPlayers = null)
        {
            var normalizedCapFreezeName =
                NormalizePlayerName(capFreezeName);

            var normalizedPosition =
                capFreezePosition
                    .Trim()
                    .ToUpperInvariant();

            if (string.IsNullOrWhiteSpace(normalizedCapFreezeName))
                return null;

            // ---------------------------------------------------------
            // STEP 1:
            // Find players currently belonging to this NHL team.
            //
            // If the team sync already loaded them, reuse that list.
            // ---------------------------------------------------------

            currentTeamPlayers ??= await _dbContext.Players
                .Where(p =>
                    p.NhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // ---------------------------------------------------------
            // STEP 2:
            // Exact official NHL name match on current team.
            // ---------------------------------------------------------

            var currentOfficialNameMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName
                    &&
                    (
                        string.IsNullOrWhiteSpace(normalizedPosition)
                        ||
                        p.Position
                            .ToUpperInvariant()
                            .Contains(normalizedPosition)
                    ));

            if (currentOfficialNameMatch != null)
            {
                currentOfficialNameMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return currentOfficialNameMatch;
            }

            // ---------------------------------------------------------
            // STEP 3:
            // Existing CapFreeze alias match on current team.
            // ---------------------------------------------------------

            var currentAliasMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (currentAliasMatch != null)
            {
                currentAliasMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return currentAliasMatch;
            }

            // ---------------------------------------------------------
            // STEP 4:
            // Find players who previously belonged to this NHL team.
            // ---------------------------------------------------------

            previousTeamPlayers ??= await _dbContext.Players
                .Where(p =>
                    p.PreviousNhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // ---------------------------------------------------------
            // STEP 5:
            // Exact official NHL name match among previous players.
            // ---------------------------------------------------------

            var previousOfficialNameMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName
                    &&
                    (
                        string.IsNullOrWhiteSpace(normalizedPosition)
                        ||
                        p.Position
                            .ToUpperInvariant()
                            .Contains(normalizedPosition)
                    ));

            if (previousOfficialNameMatch != null)
            {
                previousOfficialNameMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return previousOfficialNameMatch;
            }

            // ---------------------------------------------------------
            // STEP 6:
            // Existing CapFreeze alias match among previous players.
            // ---------------------------------------------------------

            var previousAliasMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (previousAliasMatch != null)
            {
                previousAliasMatch.CapFreezeName =
                    capFreezeName;

                if (saveChanges)
                    await _dbContext.SaveChangesAsync();

                return previousAliasMatch;
            }

            // ---------------------------------------------------------
            // STEP 7:
            // No exact match.
            // Combine current + previous team players and fuzzy match.
            // ---------------------------------------------------------

            var candidatePlayers =
                currentTeamPlayers
                    .Concat(previousTeamPlayers)
                    .GroupBy(p => p.Id)
                    .Select(g => g.First())
                    .ToList();

            if (candidatePlayers.Count == 0)
                return null;

            var parts =
                capFreezeName.Split(
                    ' ',
                    StringSplitOptions.RemoveEmptyEntries);

            if (parts.Length < 2)
                return null;

            var capFreezeFirstName =
                parts[0];

            var capFreezeLastName =
                string.Join(
                    " ",
                    parts.Skip(1));

            var normalizedCapFreezeFirstName =
                NormalizePlayerName(capFreezeFirstName);

            var normalizedCapFreezeLastName =
                NormalizePlayerName(capFreezeLastName);


            var matches =
                candidatePlayers
                    .Select(player =>
                    {
                        var normalizedDatabaseFirstName =
                            NormalizePlayerName(player.FirstName);

                        var normalizedDatabaseLastName =
                            NormalizePlayerName(player.LastName);

                        var normalizedDatabaseFullName =
                            NormalizePlayerName(
                                $"{player.FirstName} {player.LastName}");

                        return new
                        {
                            Player = player,

                            FirstNameSimilarity =
                                CalculateSimilarity(
                                    normalizedCapFreezeFirstName,
                                    normalizedDatabaseFirstName),

                            LastNameSimilarity =
                                CalculateSimilarity(
                                    normalizedCapFreezeLastName,
                                    normalizedDatabaseLastName),

                            FullNameSimilarity =
                                CalculateSimilarity(
                                    normalizedCapFreezeName,
                                    normalizedDatabaseFullName)
                        };
                    })
                    .OrderByDescending(x => x.FullNameSimilarity)
                    .ThenByDescending(x => x.LastNameSimilarity)
                    .ThenByDescending(x => x.FirstNameSimilarity)
                    .ToList();


            var bestMatch =
                matches.First();


            // ---------------------------------------------------------
            // STEP 8:
            // Reject weak fuzzy matches.
            //
            // Prevents wrong players receiving CapFreeze contracts.
            // ---------------------------------------------------------

            if (
                bestMatch.FullNameSimilarity < 0.80 &&
                bestMatch.LastNameSimilarity < 0.85)
            {
                return null;
            }


            // ---------------------------------------------------------
            // STEP 9:
            // Save CapFreeze name on matched player.
            // ---------------------------------------------------------

            bestMatch.Player.CapFreezeName =
                capFreezeName;


            // ---------------------------------------------------------
            // STEP 10:
            // Save fuzzy match review record.
            // ---------------------------------------------------------

            var existingReview =
                await _dbContext.CapFreezePlayerReviews
                    .FirstOrDefaultAsync(r =>
                        r.CapFreezeName == capFreezeName &&
                        r.PlayerId == bestMatch.Player.Id);

            if (existingReview == null)
            {
                var review =
                    new CapFreezePlayerReview
                    {
                        CapFreezeName =
                            capFreezeName,

                        PlayerId =
                            bestMatch.Player.Id,

                        FullNameSimilarity =
                            bestMatch.FullNameSimilarity,

                        FirstNameSimilarity =
                            bestMatch.FirstNameSimilarity,

                        LastNameSimilarity =
                            bestMatch.LastNameSimilarity,

                        NhlTeamId =
                            nhlTeamId,

                        IsReviewed =
                            false,

                        IsApproved =
                            null
                    };

                _dbContext.CapFreezePlayerReviews.Add(review);
            }

            if (saveChanges)
            {
                await _dbContext.SaveChangesAsync();
            }

            return bestMatch.Player;
        }

        public async Task<Player?> TestUpdatePlayerNhlTeamAsync(
    int nhlPlayerId,
    int newNhlTeamId)
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

        public async Task<object?> TestCapFreezeMatchPathAsync(
    string capFreezeName,
    int nhlTeamId)
        {
            var normalizedCapFreezeName =
                NormalizePlayerName(capFreezeName);

            // ---------------------------------------------------------
            // CURRENT TEAM
            // ---------------------------------------------------------

            var currentTeamPlayers = await _dbContext.Players
                .Where(p =>
                    p.NhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // Current team - official name
            var currentOfficialMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName);

            if (currentOfficialMatch != null)
            {
                return new
                {
                    MatchType = "CurrentTeam_OfficialName",
                    currentOfficialMatch.Id,
                    currentOfficialMatch.NhlPlayerId,
                    currentOfficialMatch.FirstName,
                    currentOfficialMatch.LastName,
                    currentOfficialMatch.NhlTeamId,
                    currentOfficialMatch.PreviousNhlTeamId,
                    currentOfficialMatch.CapFreezeName
                };
            }

            // Current team - saved CapFreezeName
            var currentAliasMatch =
                currentTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (currentAliasMatch != null)
            {
                return new
                {
                    MatchType = "CurrentTeam_CapFreezeName",
                    currentAliasMatch.Id,
                    currentAliasMatch.NhlPlayerId,
                    currentAliasMatch.FirstName,
                    currentAliasMatch.LastName,
                    currentAliasMatch.NhlTeamId,
                    currentAliasMatch.PreviousNhlTeamId,
                    currentAliasMatch.CapFreezeName
                };
            }

            // ---------------------------------------------------------
            // PREVIOUS TEAM
            // ---------------------------------------------------------

            var previousTeamPlayers = await _dbContext.Players
                .Where(p =>
                    p.PreviousNhlTeamId == nhlTeamId &&
                    !string.IsNullOrWhiteSpace(p.FirstName) &&
                    !string.IsNullOrWhiteSpace(p.LastName))
                .ToListAsync();

            // Previous team - official name
            var previousOfficialMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    NormalizePlayerName(
                        $"{p.FirstName} {p.LastName}") ==
                    normalizedCapFreezeName);

            if (previousOfficialMatch != null)
            {
                return new
                {
                    MatchType = "PreviousTeam_OfficialName",
                    previousOfficialMatch.Id,
                    previousOfficialMatch.NhlPlayerId,
                    previousOfficialMatch.FirstName,
                    previousOfficialMatch.LastName,
                    previousOfficialMatch.NhlTeamId,
                    previousOfficialMatch.PreviousNhlTeamId,
                    previousOfficialMatch.CapFreezeName
                };
            }

            // Previous team - saved CapFreezeName
            var previousAliasMatch =
                previousTeamPlayers.FirstOrDefault(p =>
                    !string.IsNullOrWhiteSpace(p.CapFreezeName) &&
                    NormalizePlayerName(p.CapFreezeName!) ==
                    normalizedCapFreezeName);

            if (previousAliasMatch != null)
            {
                return new
                {
                    MatchType = "PreviousTeam_CapFreezeName",
                    previousAliasMatch.Id,
                    previousAliasMatch.NhlPlayerId,
                    previousAliasMatch.FirstName,
                    previousAliasMatch.LastName,
                    previousAliasMatch.NhlTeamId,
                    previousAliasMatch.PreviousNhlTeamId,
                    previousAliasMatch.CapFreezeName
                };
            }

            return new
            {
                MatchType = "NoExactOrAliasMatch",
                CurrentTeamCandidateCount = currentTeamPlayers.Count,
                PreviousTeamCandidateCount = previousTeamPlayers.Count
            };
        }

        public async Task<object> SyncCapFreezeTeamAsync(
    string teamSlug,
    int nhlTeamId)
        {
            var html = await GetCapFreezeTeamPageAsync(teamSlug);

            var forwards =
                ExtractCapFreezePlayerLinks(html, "Forwards");

            var defense =
                ExtractCapFreezePlayerLinks(html, "Defense");

            var goalies =
                ExtractCapFreezePlayerLinks(html, "Goalies");

            var minors =
                ExtractCapFreezePlayerLinks(html, "Non-Roster / Minors");

            var unsignedRfas =
                ExtractCapFreezePlayerLinks(html, "Unsigned RFAs");

            var deadCap =
                ExtractCapFreezeSectionPlayers(html, "Dead Cap");


            var playerLinks =
                new List<(CapFreezePlayerLink Player, PlayerStatus Status)>();

            foreach (var player in forwards)
                playerLinks.Add((player, PlayerStatus.Rostered));

            foreach (var player in defense)
                playerLinks.Add((player, PlayerStatus.Rostered));

            foreach (var player in goalies)
                playerLinks.Add((player, PlayerStatus.Rostered));

            foreach (var player in minors)
                playerLinks.Add((player, PlayerStatus.FarmPlayer));

            foreach (var player in unsignedRfas)
                playerLinks.Add((player, PlayerStatus.RFA));


            var currentTeamPlayers =
                await _dbContext.Players
                    .Where(p => p.NhlTeamId == nhlTeamId)
                    .ToListAsync();


            var previousTeamPlayers =
                await _dbContext.Players
                    .Where(p =>
                        p.PreviousNhlTeamId == nhlTeamId &&
                        !string.IsNullOrWhiteSpace(p.FirstName) &&
                        !string.IsNullOrWhiteSpace(p.LastName))
                    .ToListAsync();


            // ---------------------------------------------------------
            // PRELOAD EXISTING CONTRACTS FOR ALL PLAYERS INVOLVED
            // ---------------------------------------------------------

            var teamPlayerIds =
                currentTeamPlayers
                    .Select(p => p.Id)
                    .Concat(
                        previousTeamPlayers.Select(p => p.Id))
                    .Distinct()
                    .ToList();

            var preloadedContracts =
                await _dbContext.PlayerContracts
                    .Where(c =>
                        teamPlayerIds.Contains(c.PlayerId))
                    .GroupBy(c => c.PlayerId)
                    .ToDictionaryAsync(
                        g => g.Key,
                        g => g.ToList());


            var normalizedDeadCapNames =
                deadCap
                    .Select(NormalizePlayerName)
                    .ToHashSet();


            foreach (var player in currentTeamPlayers)
            {
                var normalizedOfficialName =
                    NormalizePlayerName(
                        $"{player.FirstName} {player.LastName}");

                var normalizedCapFreezeName =
                    string.IsNullOrWhiteSpace(player.CapFreezeName)
                        ? string.Empty
                        : NormalizePlayerName(
                            player.CapFreezeName!);


                var isDeadCap =
                    normalizedDeadCapNames.Contains(
                        normalizedOfficialName)
                    ||
                    (
                        !string.IsNullOrWhiteSpace(
                            normalizedCapFreezeName)
                        &&
                        normalizedDeadCapNames.Contains(
                            normalizedCapFreezeName)
                    );


                if (isDeadCap)
                    continue;


                player.Status = PlayerStatus.Unsigned;
            }


            var processedPlayers =
                new List<object>();

            var unmatchedPlayers =
                new List<string>();


            foreach (var entry in playerLinks)
            {
                var capFreezeName =
                    entry.Player.Name;

                var capFreezeSlug =
                    entry.Player.Slug;

                var status =
                    entry.Status;


                var player =
                    await FindAndRecordCapFreezePlayerMatchAsync(
                        capFreezeName,
                        entry.Player.Position,
                        nhlTeamId,
                        false,
                        currentTeamPlayers,
                        previousTeamPlayers);


                if (player == null)
                {
                    unmatchedPlayers.Add(
                        capFreezeName);

                    continue;
                }


                var normalizedCapFreezeName =
                    NormalizePlayerName(
                        capFreezeName);


                var normalizedDatabaseName =
                    NormalizePlayerName(
                        $"{player.FirstName} {player.LastName}");


                var namesMatch =
                    normalizedCapFreezeName ==
                    normalizedDatabaseName;


                var isReviewed = false;


                if (!namesMatch)
                {
                    isReviewed =
                        await _dbContext.CapFreezePlayerReviews
                            .AnyAsync(r =>
                                r.CapFreezeName == capFreezeName &&
                                r.PlayerId == player.Id &&
                                r.IsReviewed);


                    if (!isReviewed)
                    {
                        unmatchedPlayers.Add(
                            capFreezeName);
                    }
                }
                else
                {
                    isReviewed = true;
                }


                player.Status = status;


                var shouldSyncContract =
                    status != PlayerStatus.RFA
                    &&
                    (namesMatch || isReviewed);


                if (shouldSyncContract)
                {
                    await SyncPlayerContractsAsync(
                        player.Id,
                        capFreezeSlug,
                        false,
                        preloadedContracts,
                        player);
                }


                processedPlayers.Add(
                    new
                    {
                        player.Id,
                        player.NhlPlayerId,
                        player.FirstName,
                        player.LastName,

                        CapFreezeName =
                            player.CapFreezeName,

                        CapFreezeSlug =
                            capFreezeSlug,

                        Status =
                            player.Status.ToString(),

                        ContractSynchronized =
                            shouldSyncContract,

                        player.NhlTeamId,
                        player.PreviousNhlTeamId
                    });
            }


            await _dbContext.SaveChangesAsync();


            return new
            {
                TeamSlug = teamSlug,

                NhlTeamId = nhlTeamId,

                ForwardsCount =
                    forwards.Count,

                DefenseCount =
                    defense.Count,

                GoaliesCount =
                    goalies.Count,

                MinorsCount =
                    minors.Count,

                UnsignedRfasCount =
                    unsignedRfas.Count,

                TotalPlayersFound =
                    playerLinks.Count,

                PlayersProcessed =
                    processedPlayers.Count,

                UnmatchedPlayers =
                    unmatchedPlayers,

                Players =
                    processedPlayers
            };
        }

        public CapFreezeContractData? ExtractCapFreezeContractData(
    string html,
    string playerName)
        {
            var document = new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            // ---------------------------------------------------------
            // STEP 1:
            // Find the Contract by Season table.
            // ---------------------------------------------------------

            var heading =
                document.DocumentNode
                    .SelectSingleNode(
                        "//h2[normalize-space()='Contract by Season']");

            if (heading == null)
                return null;

            var contractTable =
                heading.SelectSingleNode(
                    "following-sibling::table[1]");

            if (contractTable == null)
                return null;

            // ---------------------------------------------------------
            // STEP 2:
            // Read the first season from the table header.
            //
            // Example:
            // 2026-27
            // ---------------------------------------------------------

            var firstHeader =
                contractTable
                    .SelectSingleNode(".//thead//th[1]");

            if (firstHeader == null)
                return null;

            var seasonText =
                System.Net.WebUtility.HtmlDecode(
                    firstHeader.InnerText.Trim());

            var seasonMatch =
                System.Text.RegularExpressions.Regex.Match(
                    seasonText,
                    @"^(20\d{2})-(\d{2})$");

            if (!seasonMatch.Success)
                return null;

            var startYear =
                int.Parse(seasonMatch.Groups[1].Value);

            var startSeason =
                startYear * 10000 +
                (startYear + 1);

            // ---------------------------------------------------------
            // STEP 3:
            // Extract the contract length.
            //
            // We already tested ExtractContractYears().
            // ---------------------------------------------------------

            var termYears =
                ExtractContractYears(
                    html,
                    playerName);

            if (!termYears.HasValue)
                return null;

            // ---------------------------------------------------------
            // STEP 4:
            // Get the first contract row.
            // ---------------------------------------------------------

            var firstRow =
                contractTable.SelectSingleNode(
                    ".//tbody/tr");

            if (firstRow == null)
                return null;

            var salaryCells =
                firstRow.SelectNodes("./td");

            if (salaryCells == null ||
                salaryCells.Count < 2)
            {
                return null;
            }

            // ---------------------------------------------------------
            // STEP 5:
            // First salary.
            // ---------------------------------------------------------

            var firstSalaryValue =
                salaryCells[0].GetAttributeValue(
                    "data-v",
                    string.Empty);

            if (!decimal.TryParse(
                    firstSalaryValue,
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var firstSalary))
            {
                return null;
            }

            // ---------------------------------------------------------
            // STEP 6:
            // Second salary.
            //
            // If the player becomes UFA/RFA immediately after
            // the first contract, data-v may be 0.
            // ---------------------------------------------------------

            decimal? secondSalary = null;

            var secondSalaryValue =
                salaryCells[1].GetAttributeValue(
                    "data-v",
                    string.Empty);

            if (decimal.TryParse(
                    secondSalaryValue,
                    System.Globalization.NumberStyles.Number,
                    System.Globalization.CultureInfo.InvariantCulture,
                    out var parsedSecondSalary)
                && parsedSecondSalary > 0)
            {
                secondSalary = parsedSecondSalary;
            }

            return new CapFreezeContractData
            {
                StartSeason = startSeason,
                TermYears = termYears.Value,
                FirstSalary = firstSalary,
                SecondSalary = secondSalary
            };
        }

        public List<PlayerContract> BuildPlayerContracts(
    int playerId,
    CapFreezeContractData contractData)
        {
            var contracts = new List<PlayerContract>();

            // Case 1:
            // Same salary throughout the entire contract.
            if (
                contractData.SecondSalary.HasValue &&
                contractData.FirstSalary ==
                contractData.SecondSalary.Value)
            {
                var endSeason =
                    CalculateContractEndSeason(
                        contractData.StartSeason,
                        contractData.TermYears);

                contracts.Add(
                    new PlayerContract
                    {
                        PlayerId = playerId,
                        StartSeason = contractData.StartSeason,
                        EndSeason = endSeason,
                        Salary = contractData.FirstSalary
                    });

                return contracts;
            }

            // Case 2:
            // First contract lasts exactly one season.
            //
            // Example:
            // 2026-27 = $940,833
            // 2027-28 onward = $9,150,000
            if (contractData.SecondSalary.HasValue)
            {
                var secondContractStartSeason =
                    GetNextSeason(
                        contractData.StartSeason);

                var endSeason =
                    CalculateContractEndSeason(
                        contractData.StartSeason,
                        contractData.TermYears);

                contracts.Add(
                    new PlayerContract
                    {
                        PlayerId = playerId,
                        StartSeason = contractData.StartSeason,
                        EndSeason = contractData.StartSeason,
                        Salary = contractData.FirstSalary
                    });

                contracts.Add(
                    new PlayerContract
                    {
                        PlayerId = playerId,
                        StartSeason = secondContractStartSeason,
                        EndSeason = endSeason,
                        Salary = contractData.SecondSalary.Value
                    });

                return contracts;
            }

            return contracts;
        }

        private int GetNextSeason(int season)
        {
            var startYear = season / 10000;
            var endYear = season % 10000;

            return (startYear + 1) * 10000 +
                   (endYear + 1);
        }

        private int CalculateContractEndSeason(
            int startSeason,
            int termYears)
        {
            int startYear = startSeason / 10000;

            int endYear = startYear + termYears - 1;

            return (endYear * 10000) + (endYear + 1);
        }

        public async Task<List<PlayerContract>> SyncPlayerContractsAsync(
    int playerId,
    string playerSlug,
    bool saveChanges = true,
    Dictionary<int, List<PlayerContract>>? preloadedContracts = null,
    Player? player = null)
        {
            if (player == null)
            {
                player =
                    await _dbContext.Players
                        .FirstOrDefaultAsync(p => p.Id == playerId);

                if (player == null)
                    return new List<PlayerContract>();
            }

            var html =
                await GetCapFreezePlayerPageAsync(playerSlug);

            var playerName =
                $"{player.FirstName} {player.LastName}";

            var contractData =
                ExtractCapFreezeContractData(
                    html,
                    playerName);

            if (contractData == null)
                return new List<PlayerContract>();

            var expectedContracts =
                BuildPlayerContracts(
                    player.Id,
                    contractData);


            List<PlayerContract> existingContractsList;


            if (preloadedContracts != null &&
                preloadedContracts.TryGetValue(
                    playerId,
                    out var cachedContracts))
            {
                existingContractsList = cachedContracts;
            }
            else
            {
                existingContractsList =
                    await _dbContext.PlayerContracts
                        .Where(c => c.PlayerId == playerId)
                        .ToListAsync();
            }


            var existingContracts =
                existingContractsList
                    .GroupBy(c => c.StartSeason)
                    .ToDictionary(
                        g => g.Key,
                        g => g.First());


            var expectedStartSeasons =
                expectedContracts
                    .Select(c => c.StartSeason)
                    .ToHashSet();


            foreach (var expectedContract in expectedContracts)
            {
                if (existingContracts.TryGetValue(
                        expectedContract.StartSeason,
                        out var existingContract))
                {
                    existingContract.EndSeason =
                        expectedContract.EndSeason;

                    existingContract.Salary =
                        expectedContract.Salary;
                }
                else
                {
                    _dbContext.PlayerContracts.Add(
                        expectedContract);

                    existingContracts.Add(
                        expectedContract.StartSeason,
                        expectedContract);

                    existingContractsList.Add(
                        expectedContract);
                }
            }


            foreach (var existingContract in existingContracts.Values.ToList())
            {
                if (!expectedStartSeasons.Contains(
                        existingContract.StartSeason))
                {
                    _dbContext.PlayerContracts.Remove(
                        existingContract);

                    existingContractsList.Remove(
                        existingContract);
                }
            }


            if (preloadedContracts != null)
            {
                preloadedContracts[playerId] =
                    existingContractsList;
            }


            if (saveChanges)
            {
                await _dbContext.SaveChangesAsync();
            }


            return expectedContracts;
        }

        public List<CapFreezePlayerLink> ExtractCapFreezePlayerLinks(
    string html,
    string sectionName)
        {
            var document =
                new HtmlAgilityPack.HtmlDocument();

            document.LoadHtml(html);

            var sectionHeader =
                document.DocumentNode.SelectSingleNode(
                    $"//h2[contains(normalize-space(), '{sectionName}')]");

            if (sectionHeader == null)
                return new List<CapFreezePlayerLink>();

            var players =
                new List<CapFreezePlayerLink>();

            var table =
                sectionHeader.SelectSingleNode(
                    "following-sibling::table[1]");

            if (table == null)
                return players;

            var rows =
                table.SelectNodes(".//tr");

            if (rows == null)
                return players;

            foreach (var row in rows)
            {
                var playerLink =
                    row.SelectSingleNode(".//a");

                if (playerLink == null)
                    continue;

                var name =
                    System.Net.WebUtility.HtmlDecode(
                        playerLink.InnerText.Trim());

                var href =
                    playerLink.GetAttributeValue(
                        "href",
                        string.Empty);

                if (string.IsNullOrWhiteSpace(name) ||
                    string.IsNullOrWhiteSpace(href))
                {
                    continue;
                }

                var uri =
                    new Uri(
                        new Uri("https://capfreeze.com/"),
                        href);

                var slug =
                    System.IO.Path.GetFileNameWithoutExtension(
                        uri.AbsolutePath);

                // Position column is usually the second td
                var positionCell =
                    row.SelectSingleNode("./td[2]");

                var position =
                    positionCell == null
                        ? string.Empty
                        : positionCell.InnerText.Trim();

                players.Add(
                    new CapFreezePlayerLink
                    {
                        Name = name,
                        Slug = slug,
                        Position = position
                    });
            }

            return players;
        }
    }
        public class NhlPlayerBatchResult
    {
        public int PlayersProcessed { get; set; }

        public int PlayersUpdated { get; set; }

        public int PlayersFailed { get; set; }

        public List<string> FailedPlayers { get; set; } = new();
    }

    public class CapFreezeContractData
    {
        public int StartSeason { get; set; }

        public int TermYears { get; set; }

        public decimal FirstSalary { get; set; }

        public decimal? SecondSalary { get; set; }
    }
}