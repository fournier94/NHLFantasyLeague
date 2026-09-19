using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Services;
using System.Net.Http;

namespace NhlFantasyLeague.api.Services.NHL
{
    public class NhlTeamService
    {
        private readonly HttpClient _httpClient;
        private readonly AppDbContext _dbContext;
        private readonly NhlPlayerService _nhlPlayerService;

        public NhlTeamService(
    HttpClient httpClient,
    AppDbContext dbContext,
    NhlPlayerService nhlPlayerService)
        {
            _httpClient = httpClient;
            _dbContext = dbContext;
            _nhlPlayerService = nhlPlayerService;
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
                            _nhlPlayerService.UpdatePlayerNhlTeam(
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
    }
}
