using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlTeamService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;

        public NhlTeamService(
            HttpClient httpClient,
            AppDbContext dbContext)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
        }

        // =================================================================
        // Arena lookup
        // =================================================================

        private static readonly Dictionary<string, (string Arena, string City)>
            ArenaByTeamAbbreviation = new(StringComparer.OrdinalIgnoreCase)
            {
                ["ANA"] = ("Honda Center", "Anaheim"),
                ["BOS"] = ("TD Garden", "Boston"),
                ["BUF"] = ("KeyBank Center", "Buffalo"),
                ["CGY"] = ("Scotiabank Saddledome", "Calgary"),
                ["CAR"] = ("Lenovo Center", "Raleigh"),
                ["CHI"] = ("United Center", "Chicago"),
                ["COL"] = ("Ball Arena", "Denver"),
                ["CBJ"] = ("Nationwide Arena", "Columbus"),
                ["DAL"] = ("American Airlines Center", "Dallas"),
                ["DET"] = ("Little Caesars Arena", "Detroit"),
                ["EDM"] = ("Rogers Place", "Edmonton"),
                ["FLA"] = ("Amerant Bank Arena", "Sunrise"),
                ["LAK"] = ("Crypto.com Arena", "Los Angeles"),
                ["MIN"] = ("Xcel Energy Center", "Saint Paul"),
                ["MTL"] = ("Bell Centre", "Montréal"),
                ["NSH"] = ("Bridgestone Arena", "Nashville"),
                ["NJD"] = ("Prudential Center", "Newark"),
                ["NYI"] = ("UBS Arena", "Elmont"),
                ["NYR"] = ("Madison Square Garden", "New York"),
                ["OTT"] = ("Canadian Tire Centre", "Ottawa"),
                ["PHI"] = ("Wells Fargo Center", "Philadelphia"),
                ["PIT"] = ("PPG Paints Arena", "Pittsburgh"),
                ["SJS"] = ("SAP Center", "San Jose"),
                ["SEA"] = ("Climate Pledge Arena", "Seattle"),
                ["STL"] = ("Enterprise Center", "St. Louis"),
                ["TBL"] = ("Amalie Arena", "Tampa"),
                ["TOR"] = ("Scotiabank Arena", "Toronto"),
                ["UTA"] = ("Delta Center", "Salt Lake City"),
                ["VAN"] = ("Rogers Arena", "Vancouver"),
                ["VGK"] = ("T-Mobile Arena", "Paradise"),
                ["WSH"] = ("Capital One Arena", "Washington"),
                ["WPG"] = ("Canada Life Centre", "Winnipeg"),
            };

        // =================================================================
        // Standings
        // =================================================================

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

        // =================================================================
        // Team metadata (/stats/rest/en/team)
        // =================================================================

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

        // =================================================================
        // Team summary (/stats/rest/en/team/summary)
        // =================================================================

        public async Task<List<NhlTeamSummary>> FetchTeamSummariesAsync()
        {
            var url =
                "https://api.nhle.com/stats/rest/en/team/summary" +
                "?isAggregate=false&isGame=false&sort=%5B%7B%22property%22" +
                "%3A%22seasonId%22%2C%22direction%22%3A%22DESC%22%7D%2C%7B%22property%22" +
                "%3A%22points%22%2C%22direction%22%3A%22DESC%22%7D%5D" +
                "&start=0&limit=40&factCayenneExp=gamesPlayed%3E%3D0" +
                "&cayenneExp=gameTypeId%3D2";

            var response = await _httpClient
                .GetFromJsonAsync<NhlTeamSummaryResponse>(url);

            if (response == null)
            {
                return new List<NhlTeamSummary>();
            }

            return response.Data;
        }

        // =================================================================
        // Franchises (/stats/rest/en/franchise)
        // =================================================================

        public async Task<List<NhlFranchise>> FetchFranchisesAsync()
        {
            var url = "https://api.nhle.com/stats/rest/en/franchise";

            var response = await _httpClient
                .GetFromJsonAsync<NhlFranchiseResponse>(url);

            if (response == null)
            {
                return new List<NhlFranchise>();
            }

            return response.Data;
        }

        // =================================================================
        // Initial bootstrap: sync NhlTeams identity only
        // =================================================================

        public async Task<List<NhlTeam>> SyncTeamsAsync()
        {
            var currentTeams = await GetTeamsAsync();
            var teamMetadata = await GetTeamMetadataAsync();

            if (currentTeams.Count < 30)
            {
                throw new InvalidOperationException(
                    $"The NHL current standings endpoint returned only " +
                    $"{currentTeams.Count} teams. Expected at least 30. " +
                    "Aborting to avoid deleting teams on partial data.");
            }

            if (teamMetadata.Count == 0)
            {
                throw new InvalidOperationException(
                    "The NHL team metadata endpoint returned no teams.");
            }

            var metadataByAbbreviation = teamMetadata
                .Where(t => !string.IsNullOrWhiteSpace(t.TriCode))
                .GroupBy(t => t.TriCode)
                .ToDictionary(
                    g => g.Key,
                    g => g.First(),
                    StringComparer.OrdinalIgnoreCase);

            var teamsToSync = new List<(
                int TeamId,
                int? FranchiseId,
                string Name,
                string CommonName,
                string PlaceName,
                string Abbreviation,
                string? LogoUrl,
                string? ConferenceName,
                string? ConferenceAbbreviation,
                string? DivisionName,
                string? DivisionAbbreviation,
                string? OfficialSiteUrl)>();

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
                        metadata.FranchiseId,
                        currentTeam.TeamName.Default,
                        currentTeam.TeamCommonName.Default,
                        currentTeam.TeamPlaceNameWithPreposition.Default,
                        abbreviation,
                        currentTeam.TeamLogo,
                        currentTeam.ConferenceName,
                        currentTeam.ConferenceAbbrev,
                        currentTeam.DivisionName,
                        currentTeam.DivisionAbbrev,
                        metadata.OfficialSiteUrl
                    ));
            }

            var currentNhlTeamIds = teamsToSync
                .Select(t => t.TeamId)
                .ToHashSet();

            var existingTeams = await _dbContext.NhlTeams
                .ToListAsync();

            foreach (var existingTeam in existingTeams)
            {
                if (!currentNhlTeamIds.Contains(existingTeam.NhlTeamId))
                {
                    _dbContext.NhlTeams.Remove(existingTeam);
                }
            }

            await _dbContext.SaveChangesAsync();

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
                        FranchiseId = team.FranchiseId,
                        Name = team.Name,
                        CommonName = team.CommonName,
                        PlaceName = team.PlaceName,
                        Abbreviation = team.Abbreviation,
                        LogoUrl = team.LogoUrl,
                        ConferenceName = team.ConferenceName,
                        ConferenceAbbreviation =
                            team.ConferenceAbbreviation,
                        DivisionName = team.DivisionName,
                        DivisionAbbreviation =
                            team.DivisionAbbreviation,
                        OfficialSiteUrl = team.OfficialSiteUrl,
                        IsActive = true
                    };

                    ApplyArena(existingTeam);

                    _dbContext.NhlTeams.Add(existingTeam);
                }
                else
                {
                    existingTeam.FranchiseId = team.FranchiseId;
                    existingTeam.Name = team.Name;
                    existingTeam.CommonName = team.CommonName;
                    existingTeam.PlaceName = team.PlaceName;
                    existingTeam.Abbreviation = team.Abbreviation;
                    existingTeam.LogoUrl = team.LogoUrl;
                    existingTeam.ConferenceName = team.ConferenceName;
                    existingTeam.ConferenceAbbreviation =
                        team.ConferenceAbbreviation;
                    existingTeam.DivisionName = team.DivisionName;
                    existingTeam.DivisionAbbreviation =
                        team.DivisionAbbreviation;
                    existingTeam.OfficialSiteUrl =
                        team.OfficialSiteUrl;
                    existingTeam.IsActive = true;

                    ApplyArena(existingTeam);
                }

                savedTeams.Add(existingTeam);
            }

            await _dbContext.SaveChangesAsync();

            return savedTeams;
        }

        private static void ApplyArena(NhlTeam team)
        {
            if (string.IsNullOrWhiteSpace(team.Abbreviation))
            {
                return;
            }

            if (ArenaByTeamAbbreviation.TryGetValue(
                    team.Abbreviation,
                    out var arena))
            {
                team.ArenaName = arena.Arena;
                team.ArenaCity = arena.City;
            }
        }

        private static string ResolvePlaceName(
            string? apiPlaceName,
            string? fullName,
            string? commonName)
        {
            if (!string.IsNullOrWhiteSpace(apiPlaceName))
            {
                return apiPlaceName.Trim();
            }

            if (string.IsNullOrWhiteSpace(fullName) ||
                string.IsNullOrWhiteSpace(commonName))
            {
                return string.Empty;
            }

            if (fullName.EndsWith(
                    commonName,
                    StringComparison.OrdinalIgnoreCase))
            {
                return fullName
                    .Substring(0, fullName.Length - commonName.Length)
                    .Trim();
            }

            return fullName;
        }

        // =================================================================
        // Daily sync: identity + season stats
        // =================================================================

        public async Task<NhlTeamStatsSyncResult> SyncTeamSeasonStatsAsync(
            int seasonCode,
            int gameTypeId = 2,
            CancellationToken ct = default)
        {
            var result = new NhlTeamStatsSyncResult
            {
                NhlSeasonCode = seasonCode,
                GameTypeId = gameTypeId
            };

            var standings = await GetTeamsAsync();

            if (standings.Count < 30)
            {
                result.Error =
                    $"Standings endpoint returned only {standings.Count} " +
                    "teams. Aborting to avoid partial writes.";
                return result;
            }

            var teamMetadata = await GetTeamMetadataAsync();

            if (teamMetadata.Count == 0)
            {
                result.Error =
                    "Team metadata endpoint returned no teams. Aborting.";
                return result;
            }

            var franchises = await FetchFranchisesAsync();
            var summaries = await FetchTeamSummariesAsync();

            result.StandingsRows = standings.Count;
            result.MetadataRows = teamMetadata.Count;
            result.FranchiseRows = franchises.Count;
            result.SummaryRows = summaries.Count;

            var metadataByAbbreviation = teamMetadata
                .Where(t => !string.IsNullOrWhiteSpace(t.TriCode))
                .GroupBy(t => t.TriCode)
                .ToDictionary(
                    g => g.Key,
                    g => g.First(),
                    StringComparer.OrdinalIgnoreCase);

            var franchiseByMostRecentTeamId = franchises
                .Where(f => f.MostRecentTeamId.HasValue)
                .GroupBy(f => f.MostRecentTeamId!.Value)
                .ToDictionary(g => g.Key, g => g.First());

            // THE FIX: Group by TeamId and take the first to prevent duplicate key crashes
            // caused by the API returning both 2026 and 2025 seasons in the same payload.
            var summaryByTeamId = summaries
                .GroupBy(s => s.TeamId)
                .ToDictionary(g => g.Key, g => g.First());

            var existingTeams = await _dbContext.NhlTeams
                .ToListAsync(ct);

            var existingTeamsByNhlId = existingTeams
                .ToDictionary(t => t.NhlTeamId);

            var existingStats = await _dbContext.NhlTeamSeasonStats
                .Where(s =>
                    s.NhlSeasonCode == seasonCode &&
                    s.GameTypeId == gameTypeId)
                .ToListAsync(ct);

            var existingStatsByTeamId = existingStats
                .ToDictionary(s => s.NhlTeamId);

            var now = DateTime.UtcNow;

            foreach (var standing in standings)
            {
                var abbreviation = standing.TeamAbbrev.Default;

                if (!metadataByAbbreviation.TryGetValue(
                        abbreviation,
                        out var metadata))
                {
                    result.SkippedNoMetadata++;
                    continue;
                }

                if (!existingTeamsByNhlId.TryGetValue(
                        metadata.Id,
                        out var team))
                {
                    team = new NhlTeam
                    {
                        NhlTeamId = metadata.Id
                    };

                    _dbContext.NhlTeams.Add(team);
                    existingTeamsByNhlId[metadata.Id] = team;
                    result.TeamsCreated++;
                }
                else
                {
                    result.TeamsUpdated++;
                }

                team.FranchiseId = metadata.FranchiseId;
                team.Name = standing.TeamName.Default;
                team.CommonName = standing.TeamCommonName.Default;
                team.PlaceName = ResolvePlaceName(
                    standing.TeamPlaceNameWithPreposition?.Default,
                    standing.TeamName.Default,
                    standing.TeamCommonName.Default);
                team.Abbreviation = abbreviation;
                team.LogoUrl = standing.TeamLogo;
                team.ConferenceName = standing.ConferenceName;
                team.ConferenceAbbreviation =
                    standing.ConferenceAbbrev;
                team.DivisionName = standing.DivisionName;
                team.DivisionAbbreviation = standing.DivisionAbbrev;
                team.OfficialSiteUrl = metadata.OfficialSiteUrl;
                team.IsActive = true;

                if (franchiseByMostRecentTeamId.TryGetValue(
                        metadata.Id,
                        out var franchise))
                {
                    team.FirstSeasonId = franchise.FirstSeasonId;
                }

                ApplyArena(team);

                if (!existingStatsByTeamId.TryGetValue(
                        metadata.Id,
                        out var stat))
                {
                    stat = new NhlTeamSeasonStat
                    {
                        NhlTeamId = metadata.Id,
                        NhlSeasonCode = seasonCode,
                        GameTypeId = gameTypeId
                    };

                    _dbContext.NhlTeamSeasonStats.Add(stat);
                    existingStatsByTeamId[metadata.Id] = stat;
                    result.StatsCreated++;
                }
                else
                {
                    result.StatsUpdated++;
                }

                stat.GamesPlayed = standing.GamesPlayed;
                stat.Wins = standing.Wins;
                stat.Losses = standing.Losses;
                stat.OtLosses = standing.OtLosses;
                stat.Ties = standing.Ties;
                stat.Points = standing.Points;
                stat.PointPctg = standing.PointPctg;
                stat.GamesRemaining = standing.GamesRemaining;

                stat.GoalsFor = standing.GoalsFor;
                stat.GoalsAgainst = standing.GoalsAgainst;
                stat.GoalDifferential = standing.GoalDifferential;

                stat.HomeWins = standing.HomeWins;
                stat.HomeLosses = standing.HomeLosses;
                stat.HomeOtLosses = standing.HomeOtLosses;
                stat.RoadWins = standing.RoadWins;
                stat.RoadLosses = standing.RoadLosses;
                stat.RoadOtLosses = standing.RoadOtLosses;
                stat.L10Wins = standing.L10Wins;
                stat.L10Losses = standing.L10Losses;
                stat.L10OtLosses = standing.L10OtLosses;

                stat.StreakCode = standing.StreakCode;
                stat.StreakCount = standing.StreakCount;

                stat.LeagueSequence = standing.LeagueSequence;
                stat.ConferenceSequence = standing.ConferenceSequence;
                stat.DivisionSequence = standing.DivisionSequence;
                stat.WildcardSequence = standing.WildcardSequence;

                stat.ClinchIndicator = standing.ClinchIndicator;
                stat.WildcardIndicator = standing.WildcardIndicator;

                stat.ShootoutWins = standing.ShootoutWins;
                stat.ShootoutLosses = standing.ShootoutLosses;

                // THE FIX: We lookup the summary using the NHL Team ID (metadata.Id),
                // not the abbreviation.
                if (summaryByTeamId.TryGetValue(metadata.Id, out var summary))
                {
                    stat.PowerPlayPct = summary.PowerPlayPct;
                    stat.PowerPlayNetPct = summary.PowerPlayNetPct;
                    stat.PenaltyKillPct = summary.PenaltyKillPct;
                    stat.PenaltyKillNetPct = summary.PenaltyKillNetPct;
                    stat.FaceoffWinPct = summary.FaceoffWinPct;
                    stat.ShotsForPerGame = summary.ShotsForPerGame;
                    stat.ShotsAgainstPerGame =
                        summary.ShotsAgainstPerGame;
                    stat.GoalsForPerGame = summary.GoalsForPerGame;
                    stat.GoalsAgainstPerGame =
                        summary.GoalsAgainstPerGame;
                    stat.PenaltyMinutesPerGame =
                        summary.PenaltyMinutesPerGame;
                }

                stat.LastUpdatedUtc = now;
            }

            await _dbContext.SaveChangesAsync(ct);

            result.Success = true;
            return result;
        }

        // =================================================================
        // Roster
        // =================================================================

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
                            NhlPlayerService.UpdatePlayerNhlTeam(existingPlayer, team.NhlTeamId);

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
    }

    /// <summary>
    /// Summary of a team-season-stats sync run.
    /// </summary>
    public class NhlTeamStatsSyncResult
    {
        public int NhlSeasonCode { get; set; }
        public int GameTypeId { get; set; }

        public int StandingsRows { get; set; }
        public int MetadataRows { get; set; }
        public int FranchiseRows { get; set; }
        public int SummaryRows { get; set; }

        public int TeamsCreated { get; set; }
        public int TeamsUpdated { get; set; }
        public int SkippedNoMetadata { get; set; }

        public int StatsCreated { get; set; }
        public int StatsUpdated { get; set; }

        public bool Success { get; set; }
        public string? Error { get; set; }
    }
}