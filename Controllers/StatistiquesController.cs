using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;
using NhlFantasyLeague.api.Services.Cache;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Endpoints agrégés de la page Statistiques.
    ///
    /// Pour l'instant : "Meilleurs pointeurs" (tous les joueurs
    /// appartenant à une équipe fantasy de la ligue).
    ///
    /// Un seul appel remplace les 13 appels que la page faisait
    /// auparavant (1 × getLeagueTeams + 12 × getTeamRoster), et
    /// chaque ligne ne contient que les colonnes dont le tableau
    /// a besoin.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class StatistiquesController : ControllerBase
    {
        /// <summary>
        /// TTL du cache. 30 secondes, comme StandingsController :
        /// pendant une soirée de matchs les utilisateurs rafraîchissent
        /// souvent, et 30 s transforme 20 chargements/minute en 2.
        /// Hors des heures de match, rien ne change de toute façon.
        /// </summary>
        private static readonly TimeSpan CacheTtl =
            TimeSpan.FromSeconds(30);

        private readonly AppDbContext _dbContext;
        private readonly ResponseCacheService _cache;

        public StatistiquesController(
            AppDbContext dbContext,
            ResponseCacheService cache)
        {
            _dbContext = dbContext;
            _cache = cache;
        }

        /// <summary>
        /// Retourne tous les joueurs appartenant à une équipe fantasy
        /// de la ligue pour la saison courante, avec les mêmes
        /// statistiques que celles affichées sur MonEquipePage
        /// (GP / G / A / PTS / 3B / ATOI / FP + contrats).
        ///
        /// Les gardiens sont inclus : le filtrage par position est
        /// fait côté client, sur le frontend StatistiquesPage, via
        /// les quatre boutons (Tous / Attaquants / Défenseurs /
        /// Gardiens). Les colonnes G / A / PTS pour un gardien
        /// représentent ses propres buts et passes (généralement 0),
        /// pas ses victoires ni ses blanchissages.
        ///
        /// Tri par défaut : FP décroissant, puis PTS, puis buts, puis
        /// passes, puis nom de famille. Les joueurs dont le FP est
        /// null (aucun match NHL cette saison) sont relégués en bas.
        /// </summary>
        [HttpGet("top-scorers")]
        public async Task<IActionResult> GetTopScorers(
            CancellationToken ct)
        {
            var rows = await _cache.GetOrCreateAsync(
                "top-scorers:current",
                CacheTtl,
                () => BuildTopScorersAsync(ct));

            return Ok(rows);
        }

        private async Task<List<TopScorerRowDto>> BuildTopScorersAsync(
            CancellationToken ct)
        {
            var season = await SeasonQueries.GetCurrentSeasonAsync(
                _dbContext, ct);

            if (season == null)
            {
                return new List<TopScorerRowDto>();
            }

            // 1. Toutes les entrées de roster de la saison courante,
            //    jointe au joueur, à son équipe NHL et à son équipe
            //    fantasy. Aucun filtre par position : le client
            //    choisit ce qu'il veut afficher.
            var entries = await _dbContext.RosterEntries
                .AsNoTracking()
                .Include(e => e.Player)
                    .ThenInclude(p => p.NhlTeam)
                .Include(e => e.FantasyTeam)
                .Where(e =>
                    e.SeasonId == season.Id &&
                    e.Player != null)
                .ToListAsync(ct);

            if (entries.Count == 0)
            {
                return new List<TopScorerRowDto>();
            }

            var playerIds = entries
                .Select(e => e.PlayerId)
                .Distinct()
                .ToList();

            // 2. PlayerSeasonStat de la saison courante, en une seule
            //    requête. Pas de match → pas de ligne → FP null.
            var seasonStats = await _dbContext.PlayerSeasonStats
                .AsNoTracking()
                .Where(s =>
                    s.SeasonId == season.Id &&
                    playerIds.Contains(s.PlayerId))
                .ToDictionaryAsync(s => s.PlayerId, ct);

            // 3. PlayerCareerStat pour la saison en cours, game type 2,
            //    pour calculer l'ATOI (moyenne pondérée).
            var careerRows = await _dbContext.PlayerCareerStats
                .AsNoTracking()
                .Where(c =>
                    playerIds.Contains(c.PlayerId) &&
                    c.Season == season.NhlSeasonCode &&
                    c.GameTypeId == 2 &&
                    c.AverageTimeOnIce != null &&
                    c.GamesPlayed > 0)
                .Select(c => new
                {
                    c.PlayerId,
                    c.AverageTimeOnIce,
                    c.GamesPlayed
                })
                .ToListAsync(ct);

            var toiSecondsByPlayer = new Dictionary<int, int>();
            var toiGamesByPlayer = new Dictionary<int, int>();

            foreach (var row in careerRows)
            {
                var seconds = ParseToiToSeconds(row.AverageTimeOnIce);

                if (seconds <= 0) continue;

                toiSecondsByPlayer.TryGetValue(
                    row.PlayerId, out var accSeconds);
                toiGamesByPlayer.TryGetValue(
                    row.PlayerId, out var accGames);

                toiSecondsByPlayer[row.PlayerId] =
                    accSeconds + seconds * row.GamesPlayed;
                toiGamesByPlayer[row.PlayerId] =
                    accGames + row.GamesPlayed;
            }

            // 4. Tous les contrats des joueurs en portée, en une seule
            //    requête. On les regroupe en mémoire pour résoudre les
            //    contrats courant + second par joueur.
            var contracts = await _dbContext.PlayerContracts
                .AsNoTracking()
                .Where(c => playerIds.Contains(c.PlayerId))
                .ToListAsync(ct);

            var contractsByPlayer = contracts
                .GroupBy(c => c.PlayerId)
                .ToDictionary(g => g.Key, g => g.ToList());

            // 5. Composition des DTOs.
            var rows = new List<TopScorerRowDto>(entries.Count);

            foreach (var entry in entries)
            {
                var player = entry.Player!;

                seasonStats.TryGetValue(entry.PlayerId, out var stats);

                string? atoi = null;

                if (toiGamesByPlayer.TryGetValue(
                        entry.PlayerId, out var games) &&
                    games > 0 &&
                    toiSecondsByPlayer.TryGetValue(
                        entry.PlayerId, out var seconds))
                {
                    atoi = FormatToiFromSeconds(seconds / games);
                }

                contractsByPlayer.TryGetValue(
                    entry.PlayerId, out var playerContracts);

                var (currentContract, secondContract) =
                    ResolveContractLines(
                        playerContracts ?? new List<PlayerContract>(),
                        season.NhlSeasonCode);

                // SV% and GAA are computed from the season totals
                // (Saves / ShotsAgainst / GoalsAgainst / GP) instead of
                // being read from the stored columns, because the
                // stored columns are only refreshed by the landing
                // sync and can lag behind the live-tracked season
                // stats. Standard hockey formatting: SV% with 3
                // decimals, GAA with 2.
                var svPct = 0m;
                var gaa = 0m;

                if (stats != null)
                {
                    if (stats.ShotsAgainst > 0)
                    {
                        svPct = Math.Round(
                            (decimal)stats.Saves / stats.ShotsAgainst,
                            3);
                    }

                    if (stats.GamesPlayed > 0)
                    {
                        gaa = Math.Round(
                            (decimal)stats.GoalsAgainst / stats.GamesPlayed,
                            2);
                    }
                }

                rows.Add(new TopScorerRowDto
                {
                    PlayerId = entry.PlayerId,
                    NhlPlayerId = player.NhlPlayerId,
                    FirstName = player.FirstName,
                    LastName = player.LastName,
                    Position = player.Position,
                    NhlTeamAbbreviation =
          player.NhlTeam?.Abbreviation ?? string.Empty,
                    FantasyTeamId = entry.FantasyTeamId,
                    FantasyTeamName = entry.FantasyTeam?.Name,

                    GamesPlayed = stats?.GamesPlayed ?? 0,
                    Goals = stats?.Goals ?? 0,
                    Assists = stats?.Assists ?? 0,
                    Points = stats?.Points ?? 0,
                    HatTricks = stats?.HatTricks ?? 0,

                    Wins = stats?.Wins ?? 0,
                    Losses = stats?.Losses ?? 0,
                    OvertimeLosses = stats?.OvertimeLosses ?? 0,
                    Shutouts = stats?.Shutouts ?? 0,
                    SavePercentage = svPct,
                    GoalsAgainstAverage = gaa,

                    TimeOnIce = atoi,

                    CurrentContract = currentContract,
                    SecondContract = secondContract,

                    FantasyPoints = stats?.FantasyPoints,
                });
            }

            // 6. Tri : FP décroissant, puis PTS, puis buts, puis passes,
            //    puis nom. Les FP null finissent tout en bas.
            rows.Sort((a, b) =>
            {
                var aFp = a.FantasyPoints ?? int.MinValue;
                var bFp = b.FantasyPoints ?? int.MinValue;

                var fpCompare = bFp.CompareTo(aFp);
                if (fpCompare != 0) return fpCompare;

                if (b.Points != a.Points)
                {
                    return b.Points.CompareTo(a.Points);
                }

                if (b.Goals != a.Goals)
                {
                    return b.Goals.CompareTo(a.Goals);
                }

                if (b.Assists != a.Assists)
                {
                    return b.Assists.CompareTo(a.Assists);
                }

                return string.Compare(
                    a.LastName,
                    b.LastName,
                    StringComparison.Ordinal);
            });

            return rows;
        }

        // =================================================================
        // Contrats
        //
        // Même logique que RosterAdminService.ResolveContractLines /
        // ToContractLineDto. Copiée ici pour que le contrôleur
        // reste autonome ; si la règle change un jour, il faut la
        // mettre à jour aux deux endroits.
        // =================================================================

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
                Salary = contract.EffectiveSalary,
                YearsRemaining = yearsRemaining,
                StartSeason = contract.StartSeason,
                EndSeason = contract.EndSeason
            };
        }

        // =================================================================
        // ATOI helpers
        // =================================================================

        private static int ParseToiToSeconds(string? toi)
        {
            if (string.IsNullOrWhiteSpace(toi))
            {
                return -1;
            }

            var parts = toi.Split(':');

            if (parts.Length != 2)
            {
                return -1;
            }

            if (!int.TryParse(parts[0], out var minutes))
            {
                return -1;
            }

            if (!int.TryParse(parts[1], out var seconds))
            {
                return -1;
            }

            return minutes * 60 + seconds;
        }

        private static string FormatToiFromSeconds(int totalSeconds)
        {
            var minutes = totalSeconds / 60;
            var seconds = totalSeconds % 60;
            return $"{minutes}:{seconds:D2}";
        }
    }
}