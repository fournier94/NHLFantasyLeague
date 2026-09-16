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
                await Task.Delay(TimeSpan.FromSeconds(1));

                var roster = await GetRosterAsync(team.Abbreviation);

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
                            FirstName = rosterPlayer.FirstName.Default,
                            LastName = rosterPlayer.LastName.Default,
                            Position = rosterPlayer.PositionCode ?? string.Empty,
                            NhlTeamId = team.NhlTeamId,
                            HeadshotUrl = rosterPlayer.Headshot
                        };

                        _dbContext.Players.Add(existingPlayer);

                        playersByNhlId.Add(
                            rosterPlayer.Id,
                            existingPlayer);

                        result.PlayersAdded++;
                    }
                    else
                    {
                        bool changed = false;

                        var firstName = rosterPlayer.FirstName.Default;
                        var lastName = rosterPlayer.LastName.Default;
                        var position = rosterPlayer.PositionCode ?? string.Empty;
                        var headshotUrl = rosterPlayer.Headshot;

                        if (existingPlayer.FirstName != firstName)
                        {
                            existingPlayer.FirstName = firstName;
                            changed = true;
                        }

                        if (existingPlayer.LastName != lastName)
                        {
                            existingPlayer.LastName = lastName;
                            changed = true;
                        }

                        if (existingPlayer.Position != position)
                        {
                            existingPlayer.Position = position;
                            changed = true;
                        }

                        if (existingPlayer.NhlTeamId != team.NhlTeamId)
                        {
                            existingPlayer.NhlTeamId = team.NhlTeamId;
                            changed = true;
                        }

                        if (existingPlayer.HeadshotUrl != headshotUrl)
                        {
                            existingPlayer.HeadshotUrl = headshotUrl;
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

        public async Task<Player?> SavePlayerAsync(int nhlPlayerId)
        {
            var existingPlayer = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            var response = await GetPlayerAsync(nhlPlayerId);

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
                        ? DateOnly.FromDateTime(response.BirthDate.Value)
                        : null,
                    HeadshotUrl = response.Headshot
                };

                _dbContext.Players.Add(player);

                await _dbContext.SaveChangesAsync();
            }
            else
            {
                player = existingPlayer;

                player.FirstName = response.FirstName.Default;
                player.LastName = response.LastName.Default;
                player.Position = response.Position ?? string.Empty;
                player.NhlTeamId = response.CurrentTeamId;
                player.BirthDate = response.BirthDate.HasValue
                    ? DateOnly.FromDateTime(response.BirthDate.Value)
                    : null;
                player.HeadshotUrl = response.Headshot;

                await _dbContext.SaveChangesAsync();
            }

            var stats = response.FeaturedStats?.RegularSeason?.SubSeason;

            if (stats != null && response.FeaturedStats != null)
            {
                var season = await _dbContext.Seasons
                    .FirstOrDefaultAsync(s =>
                        s.NhlSeasonCode == response.FeaturedStats.Season);

                if (season != null)
                {
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
                            Points = stats.Points,
                            Wins = stats.Wins,
                            OvertimeLosses = stats.OvertimeLosses,
                            Shutouts = stats.Shutouts,
                            HatTricks = 0
                        };

                        _dbContext.PlayerSeasonStats.Add(playerStats);
                    }
                    else
                    {
                        existingStats.GamesPlayed = stats.GamesPlayed;
                        existingStats.Goals = stats.Goals;
                        existingStats.Assists = stats.Assists;
                        existingStats.Points = stats.Points;
                        existingStats.Wins = stats.Wins;
                        existingStats.OvertimeLosses = stats.OvertimeLosses;
                        existingStats.Shutouts = stats.Shutouts;
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
    }
}