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

                UpdatePlayerDraftInfo(
                    player,
                    response);

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

                UpdatePlayerDraftInfo(
                    player,
                    response);

                await _dbContext.SaveChangesAsync();
            }

            await _nhlStatsService.SyncCareerStatsFromLandingAsync(
                player,
                response);

            await _dbContext.SaveChangesAsync();

            await _nhlStatsService.UpsertFantasySeasonStatAsync(
                player,
                response);

            return player;
        }

        /// <summary>
        /// Same as SavePlayerAsync, but skips the
        /// UpsertFantasySeasonStatAsync call. Used by the career stats
        /// refresh so the NHL landing page (which lags behind the
        /// boxscore by a few hours) does not clobber the live-persisted
        /// PlayerSeasonStat.FantasyPoints / GamesPlayed / Goals / ...
        /// deltas.
        ///
        /// Only Player, PlayerCareerStat and the landing-owned columns
        /// of PlayerSeasonStat are considered safe to overwrite here.
        /// Since we cannot safely separate them, we just skip the
        /// season stat entirely.
        /// </summary>
        private async Task<Player?> RefreshPlayerWithoutSeasonStatAsync(
            int nhlPlayerId)
        {
            var existingPlayer = await _dbContext.Players
                .FirstOrDefaultAsync(p => p.NhlPlayerId == nhlPlayerId);

            var response = await GetPlayerAsync(nhlPlayerId);

            if (response == null)
            {
                return null;
            }

            if (existingPlayer == null)
            {
                return null;
            }

            var player = existingPlayer;

            player.FirstName = response.FirstName.Default;
            player.LastName = response.LastName.Default;
            player.Position = response.Position ?? string.Empty;

            UpdatePlayerNhlTeam(player, response.CurrentTeamId);

            player.BirthDate = response.BirthDate.HasValue
                ? DateOnly.FromDateTime(response.BirthDate.Value)
                : null;

            player.HeadshotUrl = response.Headshot;

            UpdatePlayerDraftInfo(player, response);

            await _dbContext.SaveChangesAsync();

            await _nhlStatsService.SyncCareerStatsFromLandingAsync(
                player, response);

            await _dbContext.SaveChangesAsync();

            // NOTE: intentionally NOT calling
            // UpsertFantasySeasonStatAsync. The landing page lags
            // behind the boxscore; overwriting the season stat here
            // would roll back live-persisted deltas.

            return player;
        }

        /// <summary>
        /// Refreshes the landing data (career stats, bio, draft info,
        /// current-season totals) for every player who played on the
        /// given date. Uses the existing SavePlayerAsync path, one
        /// player at a time, clearing the ChangeTracker between
        /// players so memory stays flat.
        ///
        /// Typical run: ~200-400 players, ~5 minutes. Runs once per
        /// day at 8:30 AM ET after the daily refresh, so the player
        /// pages show last night's results before users wake up.
        /// </summary>
        public async Task<RefreshRecentPlayersResult> RefreshPlayersWhoPlayedOnAsync(
            DateOnly date,
            int delayMsBetweenPlayers = 500,
            CancellationToken ct = default)
        {
            var result = new RefreshRecentPlayersResult { Date = date };

            // Distinct NHL player IDs who appeared in a game on this
            // date. Uses the DB, so we do not need any NHL API call
            // to figure out who played.
            var nhlPlayerIds = await _dbContext.PlayerGameLogs
                .AsNoTracking()
                .Where(g => g.GameDate == date)
                .Join(
                    _dbContext.Players.AsNoTracking(),
                    g => g.PlayerId,
                    p => p.Id,
                    (g, p) => p.NhlPlayerId)
                .Distinct()
                .ToListAsync(ct);

            result.TotalPlayers = nhlPlayerIds.Count;

            foreach (var nhlId in nhlPlayerIds)
            {
                ct.ThrowIfCancellationRequested();

                if (nhlId <= 0)
                {
                    result.SkippedNoNhlId++;
                    continue;
                }

                try
                {
                    var player = await RefreshPlayerWithoutSeasonStatAsync(nhlId);

                    if (player != null)
                    {
                        result.PlayersRefreshed++;
                    }
                    else
                    {
                        result.SkippedNoLandingData++;
                    }
                }
                catch (Exception ex)
                {
                    result.FailedPlayers++;
                    result.Errors.Add(
                        $"{nhlId}: {ex.GetType().Name}: {ex.Message}");
                }

                // Release every tracked entity before the next player.
                // Without this, memory climbs linearly over 400 players.
                _dbContext.ChangeTracker.Clear();

                if (delayMsBetweenPlayers > 0)
                {
                    await Task.Delay(delayMsBetweenPlayers, ct);
                }
            }

            return result;
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

            Console.WriteLine(
                $"[NHL DISCOVERY] Starting player discovery for {teams.Count} NHL teams.");

            foreach (var team in teams)
            {
                Console.WriteLine(
                    $"[NHL DISCOVERY] Processing team {team.Abbreviation} " +
                    $"({result.TeamsProcessed + 1}/{teams.Count})...");

                Console.WriteLine(
                    $"[NHL DISCOVERY] Requesting players for {team.Abbreviation}...");

                await Task.Delay(TimeSpan.FromSeconds(1));

                int startNumber = 0;
                int currentNumber = 0;
                int totalNumber = 0;
                bool teamFailed = false;

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
                        Console.WriteLine(
                            $"[NHL DISCOVERY] FAILED: Could not retrieve players for " +
                            $"{team.Abbreviation}.");

                        teamFailed = true;

                        break;
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
                            NhlPlayerId = statsPlayer.Id,
                            NhlTeamId = team.NhlTeamId
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

                if (teamFailed)
                {
                    continue;
                }

                result.TeamsProcessed++;

                Console.WriteLine(
                    $"[NHL DISCOVERY] Players retrieved for {team.Abbreviation}. " +
                    $"Found {totalNumber} players.");

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

            UpdatePlayerDraftInfo(
                player,
                nhlPlayer);

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

                    UpdatePlayerDraftInfo(
                        player,
                        nhlPlayer);

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

                    await _nhlStatsService.UpsertFantasySeasonStatAsync(
                        player,
                        nhlPlayer);

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

        public static void UpdatePlayerDraftInfo(
            Player player,
            NhlPlayerResponse response)
        {
            var draft = response.DraftDetails;

            if (draft == null || draft.Year == 0)
            {
                return;
            }

            player.DraftYear = draft.Year;
            player.DraftTeamAbbreviation = draft.TeamAbbrev;
            player.DraftRound = draft.Round;
            player.DraftPickInRound = draft.PickInRound;
            player.DraftOverallPick = draft.OverallPick;
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

    /// <summary>
    /// Summary of a "refresh recent players" run.
    /// </summary>
    public class RefreshRecentPlayersResult
    {
        public DateOnly Date { get; set; }
        public int TotalPlayers { get; set; }
        public int PlayersRefreshed { get; set; }
        public int SkippedNoLandingData { get; set; }
        public int SkippedNoNhlId { get; set; }
        public int FailedPlayers { get; set; }
        public List<string> Errors { get; set; } = new();
    }
}