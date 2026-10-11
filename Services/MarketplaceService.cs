using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services
{
    /// <summary>
    /// Business logic for the Marketplace page: create, list and
    /// cancel trade offers, plus respond to another manager's offer
    /// and read the responses the current manager has received.
    /// </summary>
    public class MarketplaceService
    {
        private readonly AppDbContext _dbContext;

        public MarketplaceService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        // -----------------------------------------------------------------
        // Season codes used to look up the two card stat lines (current
        // and previous). Read inline from the shared constants so the
        // file remains the single source of truth for the current year.
        // -----------------------------------------------------------------

        private const int CurrentSeasonNhlCode =
            NhlFantasyLeague.api.Constants.SeasonCodes.Current;

        private const int PreviousSeasonNhlCode =
            NhlFantasyLeague.api.Constants.SeasonCodes.Previous;

        /// <summary>
        /// One player's two card-visible stat lines (current and
        /// previous season). Either can be null when no row exists
        /// for that season in either source table.
        /// </summary>
        private sealed class PlayerStatLines
        {
            public SeasonStatLineDto? Current { get; set; }
            public SeasonStatLineDto? Previous { get; set; }
        }

        /// <summary>
        /// Sum of one player's PlayerCareerStat rows for one NHL
        /// season. A season split across several Sequence rows
        /// (mid-season trade) is aggregated into one line here,
        /// matching how RosterAdminService builds the Mon équipe
        /// card.
        ///
        /// Shutouts and HatTricks are carried so FantasyPoints can
        /// be derived from the same formula the player page uses
        /// for historical seasons. The archive does not store FP
        /// directly.
        ///
        /// TimeOnIce is a weighted average across every Sequence
        /// row, weighted by games played, and only when at least
        /// one row carries a valid ATOI value.
        /// </summary>
        private sealed class CareerStatAggregate
        {
            public int PlayerId { get; set; }
            public int Season { get; set; }
            public int GamesPlayed { get; set; }
            public int Goals { get; set; }
            public int Assists { get; set; }
            public int Points { get; set; }
            public int Wins { get; set; }
            public int Losses { get; set; }
            public int OvertimeLosses { get; set; }
            public int Shutouts { get; set; }
            public int HatTricks { get; set; }
            public string? TimeOnIce { get; set; }
        }

        /// <summary>
        /// Bulk-loads the current and previous season stat lines for
        /// a set of players, keyed by PlayerId.
        ///
        /// Two data sources:
        ///
        ///   - PlayerSeasonStat is the live-tracked table. Only the
        ///     current season has rows in it (the live refresh and
        ///     the log recompute write there). Its rows carry
        ///     HatTricks, Shutouts and FantasyPoints.
        ///
        ///   - PlayerCareerStat is the historical archive written by
        ///     the NHL landing sync. Its rows carry the raw per-
        ///     season NHL totals (GP / G / A / PTS / W / L / OTL).
        ///     This is the only place previous-season totals live,
        ///     since PlayerSeasonStat is populated for the current
        ///     season only.
        ///
        /// The two sources are combined per player:
        ///
        ///   - Current season: prefer PlayerSeasonStat (live).
        ///     Fall back to PlayerCareerStat if no live row exists.
        ///
        ///   - Previous season: use PlayerCareerStat. A live row for
        ///     the previous season is not expected, but if the
        ///     archive is missing and a live row exists, it is used
        ///     as a fallback.
        ///
        /// Both season codes are matched directly against
        /// PlayerCareerStat.Season (a raw season code int, no FK), so
        /// this works even if no Seasons row exists for the previous
        /// year.
        /// </summary>
        private async Task<Dictionary<int, PlayerStatLines>>
            LoadStatLinesByPlayerIdAsync(
                IReadOnlyCollection<int> playerIds,
                CancellationToken ct)
        {
            if (playerIds.Count == 0)
            {
                return new Dictionary<int, PlayerStatLines>();
            }

            // ---- Season rows (current and previous) -------------------
            // Needed to resolve Season.Id for the PlayerSeasonStat
            // lookup and to get the display name for the card label.
            // A missing previous-season row is tolerated: the label
            // then falls back to deriving "25-26" from the raw code.
            var seasons = await _dbContext.Seasons
                .AsNoTracking()
                .Where(s =>
                    s.NhlSeasonCode == CurrentSeasonNhlCode ||
                    s.NhlSeasonCode == PreviousSeasonNhlCode)
                .ToListAsync(ct);

            var currentSeason = seasons.FirstOrDefault(s =>
                s.NhlSeasonCode == CurrentSeasonNhlCode);

            var previousSeason = seasons.FirstOrDefault(s =>
                s.NhlSeasonCode == PreviousSeasonNhlCode);

            // ---- PlayerSeasonStat rows (current and previous) ---------
            var seasonIds = new List<int>();

            if (currentSeason != null) seasonIds.Add(currentSeason.Id);
            if (previousSeason != null) seasonIds.Add(previousSeason.Id);

            var seasonStats = seasonIds.Count == 0
                ? new List<PlayerSeasonStat>()
                : await _dbContext.PlayerSeasonStats
                    .AsNoTracking()
                    .Where(s =>
                        playerIds.Contains(s.PlayerId) &&
                        seasonIds.Contains(s.SeasonId))
                    .ToListAsync(ct);

            // ---- PlayerCareerStat rows (current and previous) ---------
            // NHL regular season rows only (GameTypeId == 2). The
            // archive's Season column is the raw code, so we can
            // filter without needing a Seasons row to exist.
            var careerRows = await _dbContext.PlayerCareerStats
                .AsNoTracking()
                .Where(r =>
                    playerIds.Contains(r.PlayerId) &&
                    r.GameTypeId == 2 &&
                    r.LeagueAbbreviation == "NHL" &&
                    (r.Season == CurrentSeasonNhlCode ||
                     r.Season == PreviousSeasonNhlCode))
                .ToListAsync(ct);

            // Aggregate per (playerId, seasonCode). A season split
            // across several Sequence rows is summed into one line,
            // matching how RosterAdminService builds the Mon équipe
            // card.
            //
            // HatTricks is nullable on the archive: the column is
            // only filled once the career hat-trick backfill has
            // run for that row. Treating null as 0 means a season
            // whose hat tricks have not been backfilled shows a
            // hat-trick count of 0, which is the same behaviour as
            // the player page's historical FP columns.
            var careerByPlayerAndSeason =
      careerRows
          .GroupBy(r => new { r.PlayerId, r.Season })
          .ToDictionary(
              g => (g.Key.PlayerId, g.Key.Season),
              g =>
              {
                  // Weighted average ATOI across every
                  // Sequence row of the season. A row whose
                  // ATOI is missing or unparsable is skipped
                  // entirely so it does not drag the average
                  // toward zero. If no row has a valid ATOI,
                  // the result stays null and the frontend
                  // renders "—".
                  var weightedSeconds = 0;
                  var weightedGames = 0;

                  foreach (var row in g)
                  {
                      var seconds = ParseToiSeconds(
                          row.AverageTimeOnIce);

                      if (seconds > 0 && row.GamesPlayed > 0)
                      {
                          weightedSeconds +=
                              seconds * row.GamesPlayed;
                          weightedGames += row.GamesPlayed;
                      }
                  }

                  string? aggregatedToi =
                      weightedGames > 0
                          ? FormatToiSeconds(
                              weightedSeconds / weightedGames)
                          : null;

                  return new CareerStatAggregate
                  {
                      PlayerId = g.Key.PlayerId,
                      Season = g.Key.Season,
                      GamesPlayed = g.Sum(r => r.GamesPlayed),
                      Goals = g.Sum(r => r.Goals),
                      Assists = g.Sum(r => r.Assists),
                      Points = g.Sum(r => r.Points),
                      Wins = g.Sum(r => r.Wins),
                      Losses = g.Sum(r => r.Losses),
                      OvertimeLosses =
                          g.Sum(r => r.OvertimeLosses),
                      Shutouts = g.Sum(r => r.Shutouts),
                      HatTricks = g.Sum(r => r.HatTricks ?? 0),
                      TimeOnIce = aggregatedToi,
                  };
              });

            var result = new Dictionary<int, PlayerStatLines>();

            foreach (var id in playerIds)
            {
                var lines = new PlayerStatLines();

                // Resolve the archive aggregates once per player.
                // The current-season live row (if any) overrides the
                // counting stats, but the archive's ATOI is always
                // the source for TimeOnIce, since PlayerSeasonStat
                // does not store it.
                careerByPlayerAndSeason.TryGetValue(
                    (id, CurrentSeasonNhlCode), out var currentArchive);

                careerByPlayerAndSeason.TryGetValue(
                    (id, PreviousSeasonNhlCode), out var previousArchive);

                // ---- Current season ----------------------------------
                // Prefer the live-tracked PlayerSeasonStat row. Fall
                // back to the archive if the live row is missing.
                PlayerSeasonStat? currentLiveRow = null;

                if (currentSeason != null)
                {
                    currentLiveRow = seasonStats.FirstOrDefault(s =>
                        s.PlayerId == id &&
                        s.SeasonId == currentSeason.Id);
                }

                if (currentLiveRow != null && currentSeason != null)
                {
                    lines.Current = ToStatLineDto(
                        currentLiveRow,
                        currentSeason,
                        currentArchive?.TimeOnIce);
                }
                else if (currentArchive != null)
                {
                    lines.Current = ToStatLineDtoFromCareer(
                        currentArchive, currentSeason);
                }

                // ---- Previous season ---------------------------------
                // Historical totals always come from the archive. If
                // the archive is missing and a live row exists for
                // the previous season, use it as a fallback.
                if (previousArchive != null)
                {
                    lines.Previous = ToStatLineDtoFromCareer(
                        previousArchive, previousSeason);
                }
                else if (previousSeason != null)
                {
                    var previousLiveRow = seasonStats.FirstOrDefault(s =>
                        s.PlayerId == id &&
                        s.SeasonId == previousSeason.Id);

                    if (previousLiveRow != null)
                    {
                        lines.Previous = ToStatLineDto(
                            previousLiveRow, previousSeason);
                    }
                }

                result[id] = lines;
            }

            return result;
        }

        /// <summary>
        /// Builds a SeasonStatLineDto from a live PlayerSeasonStat
        /// row. TimeOnIce is not stored on PlayerSeasonStat, so it
        /// is passed in by the caller (taken from the archive's
        /// aggregate for the same season) and defaults to null when
        /// the archive has no ATOI for that player and season.
        /// </summary>
        private static SeasonStatLineDto ToStatLineDto(
            PlayerSeasonStat stat,
            Season season,
            string? timeOnIce = null)
        {
            return new SeasonStatLineDto
            {
                Label = string.IsNullOrWhiteSpace(season.Name)
                    ? $"{season.NhlSeasonCode / 10000}-" +
                      $"{season.NhlSeasonCode % 100:D2}"
                    : season.Name,
                NhlSeasonCode = season.NhlSeasonCode,
                LeagueAbbreviation = "NHL",
                TeamName = null,
                GameTypeId = 2,
                GamesPlayed = stat.GamesPlayed,
                Goals = stat.Goals,
                Assists = stat.Assists,
                Points = stat.Points,
                Wins = stat.Wins,
                Losses = stat.Losses,
                OvertimeLosses = stat.OvertimeLosses,
                HatTricks = stat.HatTricks,
                Shutouts = stat.Shutouts,
                FantasyPoints = stat.FantasyPoints,
                TimeOnIce = timeOnIce,
            };
        }

        /// <summary>
        /// Builds a SeasonStatLineDto from a PlayerCareerStat
        /// aggregate. Used for previous-season rows (where only the
        /// archive has data) and as a current-season fallback when
        /// the live PlayerSeasonStat row is missing.
        ///
        /// FantasyPoints is derived from the raw counting stats,
        /// using the same formula the player page uses for
        /// historical seasons:
        ///
        ///   skaters : Points + HatTricks * 3
        ///   goalies : Points + Wins * 2 + OvertimeLosses
        ///                    + Shutouts * 3
        ///
        /// The two formulas collapse into one expression: skaters
        /// have 0 in every goalie column, and goalies have 0 in
        /// HatTricks. So a single sum covers both cases exactly.
        ///
        /// The label is taken from the matching Season row when one
        /// exists. When it does not (the previous-season Seasons
        /// row was never created), the label is derived from the
        /// raw season code, e.g. "2025-26".
        /// </summary>
        private static SeasonStatLineDto ToStatLineDtoFromCareer(
            CareerStatAggregate aggregate,
            Season? season)
        {
            var code = aggregate.Season;

            var label =
                season != null && !string.IsNullOrWhiteSpace(season.Name)
                    ? season.Name
                    : $"{code / 10000}-{code % 100:D2}";

            var fantasyPoints =
                aggregate.Points +
                aggregate.HatTricks * 3 +
                aggregate.Wins * 2 +
                aggregate.OvertimeLosses +
                aggregate.Shutouts * 3;

            return new SeasonStatLineDto
            {
                Label = label,
                NhlSeasonCode = code,
                LeagueAbbreviation = "NHL",
                TeamName = null,
                GameTypeId = 2,
                GamesPlayed = aggregate.GamesPlayed,
                Goals = aggregate.Goals,
                Assists = aggregate.Assists,
                Points = aggregate.Points,
                Wins = aggregate.Wins,
                Losses = aggregate.Losses,
                OvertimeLosses = aggregate.OvertimeLosses,
                HatTricks = aggregate.HatTricks,
                Shutouts = aggregate.Shutouts,
                FantasyPoints = fantasyPoints,
                TimeOnIce = aggregate.TimeOnIce,
            };
        }

        private static (SeasonStatLineDto? Current, SeasonStatLineDto? Previous)
      ResolveStatLinesForSlot(
          int? playerId,
          IReadOnlyDictionary<int, PlayerStatLines>? statsByPlayerId)
        {
            if (!playerId.HasValue ||
                statsByPlayerId == null ||
                !statsByPlayerId.TryGetValue(playerId.Value, out var lines))
            {
                return (null, null);
            }

            return (lines.Current, lines.Previous);
        }

        /// <summary>
        /// Parses an "MM:SS" time-on-ice string into total seconds.
        /// Returns -1 when the value is null, empty, or unparsable,
        /// so callers can distinguish "no value" from "0:00".
        /// </summary>
        private static int ParseToiSeconds(string? toi)
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

               /// <summary>
        /// Formats total seconds as an "MM:SS" time-on-ice string.
        /// Always returns a padded seconds component, e.g. "18:05",
        /// so the frontend can render it raw without further parsing.
        /// </summary>
        private static string FormatToiSeconds(int totalSeconds)
        {
            var minutes = totalSeconds / 60;
            var seconds = totalSeconds % 60;

            return $"{minutes}:{seconds:D2}";
        }

        /// <summary>
        /// Age in years from a birth date. Same computation as the
        /// one used on the roster endpoint, so a player's age reads
        /// identically on the marketplace cards and on Mon équipe.
        /// Null when no birth date is known.
        /// </summary>
        private static int? CalculateAge(DateOnly? birthDate)
        {
            if (birthDate == null)
            {
                return null;
            }

            var today = DateOnly.FromDateTime(DateTime.UtcNow);
            var age = today.Year - birthDate.Value.Year;

            if (birthDate.Value > today.AddYears(-age))
            {
                age--;
            }

            return age;
        }

        public async Task<TradeOfferActionResultDto> CreateOfferAsync(
            int userId,
            CreateTradeOfferRequest request,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour publier une offre.");
            }

            var teamId = user.FantasyTeamId.Value;

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync(ct);

            if (season == null)
            {
                return Failure(
                    "Aucune saison active. Lancez POST /api/League/setup.");
            }

            if (request.Slots == null || request.Slots.Count == 0)
            {
                return Failure(
                    "Ajoutez au moins un joueur a votre offre.");
            }

            if (request.Slots.Count > 10)
            {
                return Failure("Maximum 10 joueurs par offre.");
            }

            var rosterEntries = await _dbContext.RosterEntries
                .AsNoTracking()
                .Include(e => e.Player)
                .Where(e =>
                    e.FantasyTeamId == teamId &&
                    e.SeasonId == season.Id)
                .ToListAsync(ct);

            var rosterByPlayerId = rosterEntries
                .GroupBy(e => e.PlayerId)
                .ToDictionary(g => g.Key, g => g.First());

            var seenPlayerIds = new HashSet<int>();

            for (var i = 0; i < request.Slots.Count; i++)
            {
                var slot = request.Slots[i];

                if (!IsValidPositionGroup(slot.PositionGroup))
                {
                    return Failure(
                        $"Position invalide a l'emplacement {i + 1}. " +
                        "Utilisez F, D ou G.");
                }

                if (slot.OfferingPlayerId.HasValue)
                {
                    if (!seenPlayerIds.Add(slot.OfferingPlayerId.Value))
                    {
                        return Failure(
                            "Le meme joueur ne peut pas apparaitre " +
                            "deux fois dans la meme offre.");
                    }

                    if (!rosterByPlayerId.TryGetValue(
                            slot.OfferingPlayerId.Value,
                            out var entry))
                    {
                        return Failure(
                            $"Le joueur {slot.OfferingPlayerId.Value} " +
                            "n'est pas sur votre equipe pour la saison " +
                            "en cours.");
                    }

                    var playerGroup = PositionGroupHelper.Classify(
                        entry.Player?.Position);

                    if (!PositionMatchesGroup(
                            playerGroup, slot.PositionGroup))
                    {
                        return Failure(
                            $"La position du joueur " +
                            $"{entry.Player?.FirstName} " +
                            $"{entry.Player?.LastName} ne correspond pas " +
                            $"a la position demandee pour l'emplacement " +
                            $"{i + 1}.");
                    }
                }
            }

            var offer = new TradeOffer
            {
                CreatedByFantasyTeamId = teamId,
                SeasonId = season.Id,
                CreatedAt = DateTime.UtcNow,
                Note = string.IsNullOrWhiteSpace(request.Note)
                    ? null
                    : request.Note.Trim(),
                Status = TradeOfferStatus.Active,
            };

            for (var i = 0; i < request.Slots.Count; i++)
            {
                var slot = request.Slots[i];

                offer.Slots.Add(new TradeOfferSlot
                {
                    SlotIndex = i,
                    PositionGroup = slot.PositionGroup
                        .Trim()
                        .ToUpperInvariant(),
                    OfferingPlayerId = slot.OfferingPlayerId,
                    DemandMinContractYears = slot.DemandMinContractYears,
                    DemandMaxSalary = slot.DemandMaxSalary,
                    DemandMaxAge = slot.DemandMaxAge,
                    DemandMinPointsLastYear = slot.DemandMinPointsLastYear,
                });
            }

            _dbContext.TradeOffers.Add(offer);
            await _dbContext.SaveChangesAsync(ct);

            _dbContext.TradeOfferViews.Add(new TradeOfferView
            {
                UserId = userId,
                TradeOfferId = offer.Id,
                SeenAt = DateTime.UtcNow,
            });
            await _dbContext.SaveChangesAsync(ct);

            var reloaded = await LoadOfferDtoAsync(offer.Id, userId, ct);

            if (reloaded == null)
            {
                return Failure(
                    "Offre creee mais impossible de la recharger.");
            }

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Offre publiee.",
                Offer = reloaded,
            };
        }

        public async Task<List<TradeOfferDto>> ListActiveOffersAsync(
            int userId,
            bool includeMine,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            var userTeamId = user?.FantasyTeamId;

            var offers = await _dbContext.TradeOffers
                .AsNoTracking()
                .Include(o => o.CreatedByFantasyTeam)
                .Include(o => o.Slots)
                    .ThenInclude(s => s.OfferingPlayer)
                        .ThenInclude(p => p!.NhlTeam)
                .Where(o => o.Status == TradeOfferStatus.Active)
                .OrderByDescending(o => o.CreatedAt)
                .ToListAsync(ct);

            if (!includeMine && userTeamId.HasValue)
            {
                offers = offers
                    .Where(o => o.CreatedByFantasyTeamId != userTeamId.Value)
                    .ToList();

                var respondedOfferIds = (await _dbContext.TradeOfferResponses
                    .AsNoTracking()
                    .Where(r =>
                        r.RespondingFantasyTeamId == userTeamId.Value &&
                        r.Status == TradeOfferResponseStatus.Pending)
                    .Select(r => r.TradeOfferId)
                    .ToListAsync(ct))
                    .ToHashSet();

                if (respondedOfferIds.Count > 0)
                {
                    offers = offers
                        .Where(o => !respondedOfferIds.Contains(o.Id))
                        .ToList();
                }
            }

            var offerIds = offers.Select(o => o.Id).ToList();

            var seenIds = (await _dbContext.TradeOfferViews
                .AsNoTracking()
                .Where(v =>
                    v.UserId == userId &&
                    offerIds.Contains(v.TradeOfferId))
                .Select(v => v.TradeOfferId)
                .ToListAsync(ct))
                .ToHashSet();

            var offeredPlayerIds = offers
                .SelectMany(o => o.Slots)
                .Where(s => s.OfferingPlayerId.HasValue)
                .Select(s => s.OfferingPlayerId!.Value)
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
offeredPlayerIds, ct);

            var statsByPlayerId = await LoadStatLinesByPlayerIdAsync(
                offeredPlayerIds, ct);

            var creatorTeamIds = offers
                .Select(o => o.CreatedByFantasyTeamId)
                .Distinct()
                .ToList();

            var creatorTeamCapInfo =
                await LoadCreatorTeamCapInfoAsync(creatorTeamIds, ct);

            return offers
                .Select(o => ToDto(
                    o,
                    userTeamId,
                    contractsByPlayerId,
                    statsByPlayerId,
                    seenIds,
                    creatorTeamCapInfo))
                .ToList();
        }

        public async Task<int> MarkOffersSeenAsync(
            int userId,
            IReadOnlyCollection<int> rawOfferIds,
            CancellationToken ct = default)
        {
            if (rawOfferIds.Count == 0)
            {
                return 0;
            }

            var validOfferIds = await _dbContext.TradeOffers
                .AsNoTracking()
                .Where(o =>
                    rawOfferIds.Contains(o.Id) &&
                    o.Status == TradeOfferStatus.Active)
                .Select(o => o.Id)
                .ToListAsync(ct);

            if (validOfferIds.Count == 0)
            {
                return 0;
            }

            var alreadySeen = await _dbContext.TradeOfferViews
                .Where(v =>
                    v.UserId == userId &&
                    validOfferIds.Contains(v.TradeOfferId))
                .Select(v => v.TradeOfferId)
                .ToListAsync(ct);

            var seenSet = alreadySeen.ToHashSet();
            var now = DateTime.UtcNow;
            var inserted = 0;

            foreach (var id in validOfferIds)
            {
                if (seenSet.Contains(id))
                {
                    continue;
                }

                _dbContext.TradeOfferViews.Add(new TradeOfferView
                {
                    UserId = userId,
                    TradeOfferId = id,
                    SeenAt = now,
                });

                inserted++;
            }

            if (inserted > 0)
            {
                await _dbContext.SaveChangesAsync(ct);
            }

            return inserted;
        }

        public async Task<TradeOfferActionResultDto> CancelOfferAsync(
            int userId,
            int offerId,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure("Vous n'avez pas d'equipe.");
            }

            var offer = await _dbContext.TradeOffers
                .FirstOrDefaultAsync(o => o.Id == offerId, ct);

            if (offer == null)
            {
                return Failure("Offre introuvable.");
            }

            if (offer.CreatedByFantasyTeamId != user.FantasyTeamId.Value)
            {
                return Failure(
                    "Vous ne pouvez annuler que vos propres offres.");
            }

            if (offer.Status != TradeOfferStatus.Active)
            {
                return Failure("Cette offre n'est plus active.");
            }

            offer.Status = TradeOfferStatus.Cancelled;
            await _dbContext.SaveChangesAsync(ct);

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Offre annulee.",
            };
        }

        public async Task<TradeOfferActionResultDto> RespondToOfferAsync(
            int userId,
            int offerId,
            RespondToTradeOfferRequest request,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour repondre a une offre.");
            }

            var respondingTeamId = user.FantasyTeamId.Value;

            var offer = await _dbContext.TradeOffers
                .AsNoTracking()
                .Include(o => o.Slots)
                .FirstOrDefaultAsync(o => o.Id == offerId, ct);

            if (offer == null)
            {
                return Failure("Offre introuvable.");
            }

            if (offer.Status != TradeOfferStatus.Active)
            {
                return Failure("Cette offre n'est plus active.");
            }

            if (offer.CreatedByFantasyTeamId == respondingTeamId)
            {
                return Failure(
                    "Vous ne pouvez pas repondre a votre propre offre.");
            }

            var alreadyResponded = await _dbContext.TradeOfferResponses
                .AnyAsync(r =>
                    r.TradeOfferId == offerId &&
                    r.RespondingFantasyTeamId == respondingTeamId &&
                    r.Status == TradeOfferResponseStatus.Pending,
                    ct);

            if (alreadyResponded)
            {
                return Failure(
                    "Vous avez deja repondu a cette offre.");
            }

            if (request.Picks == null || request.Picks.Count == 0)
            {
                return Failure(
                    "Fournissez un joueur pour chaque demande de l'offre.");
            }

            var offerSlotsByIndex = offer.Slots
                .ToDictionary(s => s.SlotIndex);

            if (request.Picks.Count != offerSlotsByIndex.Count)
            {
                return Failure(
                    $"Vous devez offrir un joueur pour chacun des " +
                    $"{offerSlotsByIndex.Count} emplacement(s).");
            }

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync(ct);

            if (season == null)
            {
                return Failure(
                    "Aucune saison active. Lancez POST /api/League/setup.");
            }

            var respondingRoster = await _dbContext.RosterEntries
                .AsNoTracking()
                .Include(e => e.Player)
                .Where(e =>
                    e.FantasyTeamId == respondingTeamId &&
                    e.SeasonId == season.Id)
                .ToListAsync(ct);

            var rosterByPlayerId = respondingRoster
                .GroupBy(e => e.PlayerId)
                .ToDictionary(g => g.Key, g => g.First());

            var seenRespondingPlayerIds = new HashSet<int>();

            foreach (var pick in request.Picks)
            {
                if (!offerSlotsByIndex.TryGetValue(
                        pick.SlotIndex, out var offerSlot))
                {
                    return Failure(
                        $"L'emplacement {pick.SlotIndex + 1} n'existe " +
                        "pas dans cette offre.");
                }

                if (!seenRespondingPlayerIds.Add(pick.RespondingPlayerId))
                {
                    return Failure(
                        "Le meme joueur ne peut pas repondre a deux " +
                        "emplacements de la meme offre.");
                }

                if (!rosterByPlayerId.TryGetValue(
                        pick.RespondingPlayerId, out var entry))
                {
                    return Failure(
                        $"Le joueur {pick.RespondingPlayerId} " +
                        "n'est pas sur votre equipe pour la saison en cours.");
                }

                var playerGroup = PositionGroupHelper.Classify(
                    entry.Player?.Position);

                if (!PositionMatchesGroup(
                        playerGroup, offerSlot.PositionGroup))
                {
                    return Failure(
                        $"La position du joueur " +
                        $"{entry.Player?.FirstName} {entry.Player?.LastName} " +
                        $"ne correspond pas a l'emplacement " +
                        $"{pick.SlotIndex + 1} de l'offre.");
                }
            }

            var response = new TradeOfferResponse
            {
                TradeOfferId = offerId,
                RespondingFantasyTeamId = respondingTeamId,
                CreatedAt = DateTime.UtcNow,
                Status = TradeOfferResponseStatus.Pending,
            };

            foreach (var pick in request.Picks)
            {
                response.Slots.Add(new TradeOfferResponseSlot
                {
                    SlotIndex = pick.SlotIndex,
                    RespondingPlayerId = pick.RespondingPlayerId,
                });
            }

            _dbContext.TradeOfferResponses.Add(response);
            await _dbContext.SaveChangesAsync(ct);

            var dto = await LoadResponseDtoAsync(response.Id, ct);

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Offre envoyee.",
                Response = dto,
            };
        }

        public async Task<List<TradeOfferResponseDto>> ListReceivedResponsesAsync(
            int userId,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return new List<TradeOfferResponseDto>();
            }

            var myTeamId = user.FantasyTeamId.Value;

            var responses = await _dbContext.TradeOfferResponses
     .AsNoTracking()
     .Include(r => r.TradeOffer)
         .ThenInclude(o => o.Slots)
             .ThenInclude(s => s.OfferingPlayer)
                 .ThenInclude(p => p!.NhlTeam)
     .Include(r => r.TradeOffer)
         .ThenInclude(o => o.CreatedByFantasyTeam)
     .Include(r => r.RespondingFantasyTeam)
     .Include(r => r.Slots)
         .ThenInclude(s => s.RespondingPlayer)
             .ThenInclude(p => p!.NhlTeam)
     .Where(r =>
         r.TradeOffer.CreatedByFantasyTeamId == myTeamId &&
         r.TradeOffer.Status == TradeOfferStatus.Active &&
         (r.Status == TradeOfferResponseStatus.Pending ||
          r.Status == TradeOfferResponseStatus.Accepted))
     .OrderByDescending(r => r.CreatedAt)
     .ToListAsync(ct);

            if (responses.Count == 0)
            {
                return new List<TradeOfferResponseDto>();
            }

            // Both sides of every slot: the offering player from the
            // original offer, and the responding player.
            var playerIds = responses
                .SelectMany(r => r.Slots)
                .Select(s => s.RespondingPlayerId)
                .Concat(
                    responses
                        .SelectMany(r => r.TradeOffer.Slots)
                        .Where(s => s.OfferingPlayerId.HasValue)
                        .Select(s => s.OfferingPlayerId!.Value))
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
                playerIds, ct);

            var statsByPlayerId = await LoadStatLinesByPlayerIdAsync(
                playerIds, ct);

            return responses
     .Select(r => ToResponseDto(
         r,
         contractsByPlayerId,
         statsByPlayerId))
     .ToList();
        }

        public async Task<List<TradeOfferResponseDto>> ListSentResponsesAsync(
            int userId,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return new List<TradeOfferResponseDto>();
            }

            var myTeamId = user.FantasyTeamId.Value;

            var responses = await _dbContext.TradeOfferResponses
      .AsNoTracking()
      .Include(r => r.TradeOffer)
          .ThenInclude(o => o.Slots)
              .ThenInclude(s => s.OfferingPlayer)
                  .ThenInclude(p => p!.NhlTeam)
      .Include(r => r.TradeOffer)
          .ThenInclude(o => o.CreatedByFantasyTeam)
      .Include(r => r.RespondingFantasyTeam)
      .Include(r => r.Slots)
          .ThenInclude(s => s.RespondingPlayer)
              .ThenInclude(p => p!.NhlTeam)
      .Where(r =>
          r.RespondingFantasyTeamId == myTeamId &&
          r.TradeOffer.Status == TradeOfferStatus.Active &&
          (r.Status == TradeOfferResponseStatus.Pending ||
           r.Status == TradeOfferResponseStatus.Accepted))
      .OrderByDescending(r => r.CreatedAt)
      .ToListAsync(ct);

            if (responses.Count == 0)
            {
                return new List<TradeOfferResponseDto>();
            }

            // Both sides of every slot: the offering player from the
            // original offer, and the responding player.
            var playerIds = responses
                .SelectMany(r => r.Slots)
                .Select(s => s.RespondingPlayerId)
                .Concat(
                    responses
                        .SelectMany(r => r.TradeOffer.Slots)
                        .Where(s => s.OfferingPlayerId.HasValue)
                        .Select(s => s.OfferingPlayerId!.Value))
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
                playerIds, ct);

            var statsByPlayerId = await LoadStatLinesByPlayerIdAsync(
                playerIds, ct);

            return responses
     .Select(r => ToResponseDto(
         r,
         contractsByPlayerId,
         statsByPlayerId))
     .ToList();
        }

        public async Task<TradeOfferActionResultDto> AcceptOfferResponseAsync(
            int userId,
            int responseId,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour accepter une reponse.");
            }

            var response = await _dbContext.TradeOfferResponses
                .Include(r => r.TradeOffer)
                .FirstOrDefaultAsync(r => r.Id == responseId, ct);

            if (response == null)
            {
                return Failure("Reponse introuvable.");
            }

            if (response.TradeOffer.CreatedByFantasyTeamId !=
                user.FantasyTeamId.Value)
            {
                return Failure(
                    "Vous ne pouvez accepter que les reponses a vos " +
                    "propres offres.");
            }

            if (response.Status != TradeOfferResponseStatus.Pending)
            {
                return Failure(
                    "Cette reponse a deja ete traitee.");
            }

            if (response.TradeOffer.Status != TradeOfferStatus.Active)
            {
                return Failure("Cette offre n'est plus active.");
            }

            response.Status = TradeOfferResponseStatus.Accepted;
            await _dbContext.SaveChangesAsync(ct);

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Reponse acceptee.",
            };
        }

        /// <summary>
        /// Cancels a Pending response that the calling user's team
        /// sent to someone else's offer. The original offer stays
        /// Active — only this response is withdrawn.
        ///
        /// Authorization: only the responding team can cancel its
        /// own response. The offer creator cannot cancel it (that
        /// would be a rejection, which is a different flow).
        ///
        /// State: the response must still be Pending. An Accepted
        /// or already-Cancelled response cannot be cancelled.
        /// </summary>
        public async Task<TradeOfferActionResultDto> CancelOfferResponseAsync(
            int userId,
            int responseId,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour annuler une " +
                    "reponse.");
            }

            var response = await _dbContext.TradeOfferResponses
                .Include(r => r.TradeOffer)
                .FirstOrDefaultAsync(r => r.Id == responseId, ct);

            if (response == null)
            {
                return Failure("Reponse introuvable.");
            }

            if (response.RespondingFantasyTeamId !=
                user.FantasyTeamId.Value)
            {
                return Failure(
                    "Vous ne pouvez annuler que les reponses envoyees " +
                    "par votre propre equipe.");
            }

            if (response.Status != TradeOfferResponseStatus.Pending)
            {
                return Failure(
                    "Cette reponse n'est plus en attente et ne peut " +
                    "plus etre annulee.");
            }

            response.Status = TradeOfferResponseStatus.Cancelled;
            await _dbContext.SaveChangesAsync(ct);

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Reponse annulee.",
            };
        }

        /// <summary>
        /// Refuses a Pending response to one of the calling user's
        /// own offers.
        ///
        /// The TradeOffer itself is NOT touched. Refusing a specific
        /// answer only tells the responding manager that his answer
        /// was not accepted; the announcement stays Active and keeps
        /// its place on the market in "Vos offres actives". Other
        /// managers (including the one who was just refused) can
        /// still see it and submit new responses.
        ///
        /// What changes: the response moves from Pending to Rejected.
        /// That single status flip removes it from:
        ///
        ///   - the offer creator's "Offres reçues" list (filtered on
        ///     Pending or Accepted);
        ///   - the responder's "Offres envoyées" list (same filter);
        ///   - the responder's own "browse" exclusion (only Pending
        ///     responses hide the offer from the browse list, so once
        ///     the response is Rejected, the offer is visible to him
        ///     again should he change his mind and re-answer).
        ///
        /// Authorization: only the offer's creator can refuse a
        /// response. A responder cannot refuse his own response
        /// through this endpoint (that is what CancelOfferResponseAsync
        /// is for).
        /// </summary>
        public async Task<TradeOfferActionResultDto> RejectOfferResponseAsync(
            int userId,
            int responseId,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour refuser une " +
                    "reponse.");
            }

            var response = await _dbContext.TradeOfferResponses
                .Include(r => r.TradeOffer)
                .FirstOrDefaultAsync(r => r.Id == responseId, ct);

            if (response == null)
            {
                return Failure("Reponse introuvable.");
            }

            if (response.TradeOffer.CreatedByFantasyTeamId !=
                user.FantasyTeamId.Value)
            {
                return Failure(
                    "Vous ne pouvez refuser que les reponses a vos " +
                    "propres offres.");
            }

            if (response.Status != TradeOfferResponseStatus.Pending)
            {
                return Failure(
                    "Cette reponse a deja ete traitee.");
            }

            // Refuse the response in place. The TradeOffer is left
            // untouched: it stays Active, stays in "Vos offres
            // actives", and stays visible to every other manager.
            // Only this specific response is discarded.
            response.Status = TradeOfferResponseStatus.Rejected;

            await _dbContext.SaveChangesAsync(ct);

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Réponse refusée.",
            };
        }

        // -----------------------------------------------------------------
        // Admin: accepted trades awaiting manual player swaps
        // -----------------------------------------------------------------

        /// <summary>
        /// Returns every accepted TradeOfferResponse in the league,
        /// newest first, with both sides of every slot fully populated
        /// so the commissioner can perform the manual roster swaps
        /// without opening any other screen.
        ///
        /// Commissioner-only at the controller layer.
        /// </summary>
        public async Task<List<AdminAcceptedTradeDto>>
            ListAcceptedTradesAsync(CancellationToken ct = default)
        {
            var responses = await _dbContext.TradeOfferResponses
                .AsNoTracking()
                .Include(r => r.TradeOffer)
                    .ThenInclude(o => o.CreatedByFantasyTeam)
                .Include(r => r.TradeOffer)
                    .ThenInclude(o => o.Slots)
                        .ThenInclude(s => s.OfferingPlayer)
                            .ThenInclude(p => p!.NhlTeam)
                .Include(r => r.RespondingFantasyTeam)
                .Include(r => r.Slots)
                    .ThenInclude(s => s.RespondingPlayer)
                        .ThenInclude(p => p!.NhlTeam)
                .Where(r =>
                    r.Status == TradeOfferResponseStatus.Accepted)
                .OrderByDescending(r => r.CreatedAt)
                .ToListAsync(ct);

            return responses
                .Select(r =>
                {
                    var offerSlotsByIndex = r.TradeOffer.Slots
                        .ToDictionary(s => s.SlotIndex);

                    return new AdminAcceptedTradeDto
                    {
                        ResponseId = r.Id,
                        TradeOfferId = r.TradeOfferId,
                        OfferCreatorTeamId =
                            r.TradeOffer.CreatedByFantasyTeamId,
                        OfferCreatorTeamName =
                            r.TradeOffer.CreatedByFantasyTeam?.Name
                            ?? string.Empty,
                        RespondingTeamId = r.RespondingFantasyTeamId,
                        RespondingTeamName =
                            r.RespondingFantasyTeam?.Name
                            ?? string.Empty,
                        CreatedAt = r.CreatedAt,
                        Note = r.TradeOffer.Note,
                        Slots = r.Slots
                            .OrderBy(s => s.SlotIndex)
                            .Select(s =>
                            {
                                offerSlotsByIndex.TryGetValue(
                                    s.SlotIndex,
                                    out var offerSlot);

                                return new AdminAcceptedTradeSlotDto
                                {
                                    SlotIndex = s.SlotIndex,
                                    PositionGroup =
                                        offerSlot?.PositionGroup
                                        ?? string.Empty,

                                    OfferingPlayerId =
                                        offerSlot?.OfferingPlayerId,
                                    OfferingPlayerNhlPlayerId =
                                        offerSlot?.OfferingPlayer
                                            ?.NhlPlayerId,
                                    OfferingPlayerFirstName =
                                        offerSlot?.OfferingPlayer
                                            ?.FirstName,
                                    OfferingPlayerLastName =
                                        offerSlot?.OfferingPlayer
                                            ?.LastName,
                                    OfferingPlayerNhlTeam =
                                        offerSlot?.OfferingPlayer
                                            ?.NhlTeam?.Abbreviation,

                                    RespondingPlayerId =
                                        s.RespondingPlayerId,
                                    RespondingPlayerNhlPlayerId =
                                        s.RespondingPlayer
                                            ?.NhlPlayerId,
                                    RespondingPlayerFirstName =
                                        s.RespondingPlayer
                                            ?.FirstName,
                                    RespondingPlayerLastName =
                                        s.RespondingPlayer
                                            ?.LastName,
                                    RespondingPlayerNhlTeam =
                                        s.RespondingPlayer
                                            ?.NhlTeam?.Abbreviation,
                                };
                            })
                            .ToList(),
                    };
                })
                .ToList();
        }

        /// <summary>
        /// Deletes the entire TradeOffer that owns the given accepted
        /// response, so the trade disappears from every section it was
        /// visible in:
        ///
        ///   - the commissioner's "Trades en attentes";
        ///   - the offer creator's "Vos offres actives";
        ///   - the responder's "Offres envoyées";
        ///   - everyone else's "Voir les offres".
        ///
        /// Uses the same cascade rules as RejectOfferResponseAsync: the
        /// TradeOffer, its slots, every response on it, and every
        /// per-user "seen" marker are all removed in one transaction.
        ///
        /// Only rows whose response status is Accepted can be deleted
        /// through this endpoint. Rejecting a Pending response has its
        /// own dedicated flow.
        ///
        /// Commissioner-only at the controller layer.
        /// </summary>
        public async Task<TradeOfferActionResultDto>
            AdminDeleteAcceptedTradeAsync(
                int responseId,
                CancellationToken ct = default)
        {
            var response = await _dbContext.TradeOfferResponses
                .Include(r => r.TradeOffer)
                .FirstOrDefaultAsync(r => r.Id == responseId, ct);

            if (response == null)
            {
                return Failure("Reponse introuvable.");
            }

            if (response.Status != TradeOfferResponseStatus.Accepted)
            {
                return Failure(
                    "Cette reponse n'est pas dans l'etat Accepted.");
            }

            _dbContext.TradeOffers.Remove(response.TradeOffer);

            await _dbContext.SaveChangesAsync(ct);

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Trade accepte supprime.",
            };
        }

        private async Task<TradeOfferDto?> LoadOfferDtoAsync(
            int offerId,
            int userId,
            CancellationToken ct)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            var offer = await _dbContext.TradeOffers
                .AsNoTracking()
                .Include(o => o.CreatedByFantasyTeam)
                .Include(o => o.Slots)
                    .ThenInclude(s => s.OfferingPlayer)
                        .ThenInclude(p => p!.NhlTeam)
                .FirstOrDefaultAsync(o => o.Id == offerId, ct);

            if (offer == null)
            {
                return null;
            }

            var offeredPlayerIds = offer.Slots
                .Where(s => s.OfferingPlayerId.HasValue)
                .Select(s => s.OfferingPlayerId!.Value)
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
offeredPlayerIds, ct);

            var statsByPlayerId = await LoadStatLinesByPlayerIdAsync(
                offeredPlayerIds, ct);

            var creatorTeamCapInfo = await LoadCreatorTeamCapInfoAsync(
                new[] { offer.CreatedByFantasyTeamId },
                ct);

            return ToDto(
                offer,
                user?.FantasyTeamId,
                contractsByPlayerId,
                statsByPlayerId,
                seenOfferIds: null,
                creatorTeamCapInfo);
        }

        private async Task<TradeOfferResponseDto?> LoadResponseDtoAsync(
     int responseId,
     CancellationToken ct)
        {
            var response = await _dbContext.TradeOfferResponses
                .AsNoTracking()
                .Include(r => r.TradeOffer)
                    .ThenInclude(o => o.Slots)
                        .ThenInclude(s => s.OfferingPlayer)
                            .ThenInclude(p => p!.NhlTeam)
                .Include(r => r.TradeOffer)
                    .ThenInclude(o => o.CreatedByFantasyTeam)
                .Include(r => r.RespondingFantasyTeam)
                .Include(r => r.Slots)
                    .ThenInclude(s => s.RespondingPlayer)
                        .ThenInclude(p => p!.NhlTeam)
                .FirstOrDefaultAsync(r => r.Id == responseId, ct);

            if (response == null)
            {
                return null;
            }

            // Load contracts and stats for BOTH sides of every slot:
            // the offering player from the original offer, and the
            // responding player.
            var playerIds = response.Slots
                .Select(s => s.RespondingPlayerId)
                .Concat(
                    response.TradeOffer.Slots
                        .Where(s => s.OfferingPlayerId.HasValue)
                        .Select(s => s.OfferingPlayerId!.Value))
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
                playerIds, ct);

            var statsByPlayerId = await LoadStatLinesByPlayerIdAsync(
                playerIds, ct);

            return ToResponseDto(
                response,
                contractsByPlayerId,
                statsByPlayerId);
        }

        private async Task<Dictionary<int, List<PlayerContract>>>
            LoadContractsByPlayerIdAsync(
                IReadOnlyCollection<int> playerIds,
                CancellationToken ct)
        {
            if (playerIds.Count == 0)
            {
                return new Dictionary<int, List<PlayerContract>>();
            }

            var contracts = await _dbContext.PlayerContracts
                .AsNoTracking()
                .Where(c => playerIds.Contains(c.PlayerId))
                .ToListAsync(ct);

            return contracts
                .GroupBy(c => c.PlayerId)
                .ToDictionary(g => g.Key, g => g.ToList());
        }

        private static (
            PlayerContractLineDto? Current,
            PlayerContractLineDto? Second)
            ResolveContractLinesForSlot(
                int? offeringPlayerId,
                IReadOnlyDictionary<int, List<PlayerContract>>?
                    contractsByPlayerId)
        {
            if (!offeringPlayerId.HasValue ||
                contractsByPlayerId == null ||
                !contractsByPlayerId.TryGetValue(
                    offeringPlayerId.Value, out var contracts) ||
                contracts.Count == 0)
            {
                return (null, null);
            }

            return ResolveContractLines(contracts);
        }

        private static (
            PlayerContractLineDto? Current,
            PlayerContractLineDto? Second)
            ResolveContractLines(
                IReadOnlyList<PlayerContract> contracts)
        {
            var seasonCode =
                NhlFantasyLeague.api.Constants.SeasonCodes.Current;

            var ordered = contracts
                .OrderBy(c => c.StartSeason)
                .ToList();

            var current = ordered.FirstOrDefault(c =>
                c.StartSeason <= seasonCode &&
                c.EndSeason >= seasonCode);

            if (current == null && ordered.Count == 1)
            {
                current = ordered[0];
            }

            var currentEnd = current?.EndSeason ?? seasonCode;

            var second = ordered
                .Where(c => c.StartSeason > currentEnd)
                .OrderBy(c => c.StartSeason)
                .FirstOrDefault();

            return (
                current == null
                    ? null
                    : ToContractLineDto(current, seasonCode),
                second == null
                    ? null
                    : ToContractLineDto(second, seasonCode));
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
                EndSeason = contract.EndSeason,
            };
        }

        private static TradeOfferDto ToDto(
   TradeOffer offer,
   int? userTeamId,
   IReadOnlyDictionary<int, List<PlayerContract>>?
       contractsByPlayerId = null,
   IReadOnlyDictionary<int, PlayerStatLines>?
       statsByPlayerId = null,
   IReadOnlySet<int>? seenOfferIds = null,
   CreatorTeamCapInfo? creatorTeamCapInfo = null)
        {
            // Creator's current cap hit. Null when the caller did
            // not provide cap info — the received / sent panels
            // build a synthetic TradeOffer from a response, and
            // they never pass cap info.
            decimal? createdByCap =
                creatorTeamCapInfo != null &&
                creatorTeamCapInfo.CapByTeamId.TryGetValue(
                    offer.CreatedByFantasyTeamId,
                    out var cap)
                    ? cap
                    : null;

            return new TradeOfferDto
            {
                Id = offer.Id,
                CreatedByFantasyTeamId = offer.CreatedByFantasyTeamId,
                CreatedByFantasyTeamName =
                    offer.CreatedByFantasyTeam?.Name ?? string.Empty,
                CreatedByFantasyTeamCapSalary = createdByCap,
                CreatedAt = offer.CreatedAt,
                Note = offer.Note,
                Status = offer.Status.ToString(),
                IsMine = userTeamId.HasValue &&
                         userTeamId.Value == offer.CreatedByFantasyTeamId,
                IsNew = seenOfferIds != null &&
                        !seenOfferIds.Contains(offer.Id),
                Slots = offer.Slots
                    .OrderBy(s => s.SlotIndex)
                    .Select(s =>
                    {
                        var (current, second) =
                            ResolveContractLinesForSlot(
                                s.OfferingPlayerId,
                                contractsByPlayerId);

                        var (currentStats, previousStats) =
                            ResolveStatLinesForSlot(
                                s.OfferingPlayerId,
                                statsByPlayerId);

                        // Roster status of the offering player, on
                        // the creator's team, for the current
                        // season. Null when the player is no longer
                        // on the creator's roster (stale offer) or
                        // when cap info was not loaded.
                        string? offeringStatus = null;

                        if (s.OfferingPlayerId.HasValue &&
                            creatorTeamCapInfo != null)
                        {
                            creatorTeamCapInfo.StatusByTeamAndPlayer
                                .TryGetValue(
                                    (offer.CreatedByFantasyTeamId,
                                     s.OfferingPlayerId.Value),
                                    out offeringStatus);
                        }

                        return new TradeOfferSlotDto
                        {
                            SlotIndex = s.SlotIndex,
                            PositionGroup = s.PositionGroup,
                            OfferingPlayerId = s.OfferingPlayerId,
                            OfferingPlayerNhlPlayerId =
            s.OfferingPlayer?.NhlPlayerId,
                            OfferingPlayerFirstName =
            s.OfferingPlayer?.FirstName,
                            OfferingPlayerLastName =
                                s.OfferingPlayer?.LastName,
                            OfferingPlayerNhlTeam =
                                s.OfferingPlayer?.NhlTeam?.Abbreviation,
                            OfferingPlayerPosition =
                                s.OfferingPlayer?.Position,
                            OfferingPlayerAge = CalculateAge(
                                s.OfferingPlayer?.BirthDate),
                            OfferingPlayerRosterStatus = offeringStatus,
                            OfferingPlayerCurrentContract = current,
                            OfferingPlayerSecondContract = second,
                            OfferingPlayerCurrentSeasonStats =
                                currentStats,
                            OfferingPlayerLastSeasonStats =
                                previousStats,
                            DemandMinContractYears =
                                s.DemandMinContractYears,
                            DemandMaxSalary = s.DemandMaxSalary,
                            DemandMaxAge = s.DemandMaxAge,
                            DemandMinPointsLastYear =
                                s.DemandMinPointsLastYear,
                        };
                    })
                    .ToList(),
            };
        }

        private static TradeOfferResponseDto ToResponseDto(
TradeOfferResponse response,
IReadOnlyDictionary<int, List<PlayerContract>> contractsByPlayerId,
IReadOnlyDictionary<int, PlayerStatLines> statsByPlayerId)
        {
            var offerSlotsByIndex = response.TradeOffer.Slots
                .ToDictionary(s => s.SlotIndex);

            return new TradeOfferResponseDto
            {
                Id = response.Id,
                TradeOfferId = response.TradeOfferId,
                TradeOfferNote = response.TradeOffer.Note,
                TradeOfferCreatedByFantasyTeamId =
                    response.TradeOffer.CreatedByFantasyTeamId,
                TradeOfferCreatedByFantasyTeamName =
                    response.TradeOffer.CreatedByFantasyTeam?.Name
                    ?? string.Empty,
                RespondingFantasyTeamId = response.RespondingFantasyTeamId,
                RespondingFantasyTeamName =
                    response.RespondingFantasyTeam?.Name ?? string.Empty,
                CreatedAt = response.CreatedAt,
                Status = response.Status.ToString(),
                Slots = response.Slots
                    .OrderBy(s => s.SlotIndex)
                    .Select(s =>
                    {
                        offerSlotsByIndex.TryGetValue(
                            s.SlotIndex,
                            out var offerSlot);

                        // ---- RIGHT side: responding player ----
                        var (respondCurrent, respondSecond) =
                            ResolveContractLinesForSlot(
                                s.RespondingPlayerId,
                                contractsByPlayerId);

                        var (respondCurrentStats, respondPrevStats) =
                            ResolveStatLinesForSlot(
                                s.RespondingPlayerId,
                                statsByPlayerId);

                        // ---- LEFT side: offering player on the original offer ----
                        var (offeringCurrent, offeringSecond) =
                            ResolveContractLinesForSlot(
                                offerSlot?.OfferingPlayerId,
                                contractsByPlayerId);

                        var (offeringCurrentStats, offeringPrevStats) =
                            ResolveStatLinesForSlot(
                                offerSlot?.OfferingPlayerId,
                                statsByPlayerId);

                        return new TradeOfferResponseSlotDto
                        {
                            SlotIndex = s.SlotIndex,
                            PositionGroup =
                                offerSlot?.PositionGroup ?? string.Empty,

                            // LEFT: offering side, copied from the
                            // original offer slot.
                            OfferingPlayerId = offerSlot?.OfferingPlayerId,
                            OfferingPlayerNhlPlayerId =
                                offerSlot?.OfferingPlayer?.NhlPlayerId,
                            OfferingPlayerFirstName =
                                offerSlot?.OfferingPlayer?.FirstName,
                            OfferingPlayerLastName =
                                offerSlot?.OfferingPlayer?.LastName,
                            OfferingPlayerNhlTeam =
                                offerSlot?.OfferingPlayer?.NhlTeam?.Abbreviation,
                            OfferingPlayerPosition =
                                offerSlot?.OfferingPlayer?.Position,
                            OfferingPlayerAge = CalculateAge(
                                offerSlot?.OfferingPlayer?.BirthDate),
                            OfferingPlayerCurrentContract = offeringCurrent,
                            OfferingPlayerSecondContract = offeringSecond,
                            OfferingPlayerCurrentSeasonStats =
                                offeringCurrentStats,
                            OfferingPlayerLastSeasonStats =
                                offeringPrevStats,

                            // RIGHT: responding side.
                            RespondingPlayerId = s.RespondingPlayerId,
                            RespondingPlayerNhlPlayerId =
                                s.RespondingPlayer?.NhlPlayerId,
                            RespondingPlayerFirstName =
                                s.RespondingPlayer?.FirstName,
                            RespondingPlayerLastName =
                                s.RespondingPlayer?.LastName,
                            RespondingPlayerNhlTeam =
                                s.RespondingPlayer?.NhlTeam?.Abbreviation,
                            RespondingPlayerPosition =
                                s.RespondingPlayer?.Position,
                            RespondingPlayerAge = CalculateAge(
                                s.RespondingPlayer?.BirthDate),
                            RespondingPlayerCurrentContract = respondCurrent,
                            RespondingPlayerSecondContract = respondSecond,
                            RespondingPlayerCurrentSeasonStats =
                                respondCurrentStats,
                            RespondingPlayerLastSeasonStats =
                                respondPrevStats,

                            // Demand filters (kept on the DTO).
                            DemandMinContractYears =
                                offerSlot?.DemandMinContractYears,
                            DemandMaxSalary = offerSlot?.DemandMaxSalary,
                            DemandMaxAge = offerSlot?.DemandMaxAge,
                            DemandMinPointsLastYear =
                                offerSlot?.DemandMinPointsLastYear,
                        };
                    })
                    .ToList(),
            };
        }

        private static bool IsValidPositionGroup(string? pg)
        {
            if (string.IsNullOrWhiteSpace(pg))
            {
                return false;
            }

            var v = pg.Trim().ToUpperInvariant();
            return v == "F" || v == "D" || v == "G";
        }

        private static bool PositionMatchesGroup(
            PositionGroup group,
            string pg)
        {
            var v = pg.Trim().ToUpperInvariant();

            return v switch
            {
                "F" => group == PositionGroup.Forward,
                "D" => group == PositionGroup.Defense,
                "G" => group == PositionGroup.Goalie,
                _ => false,
            };
        }

        private static TradeOfferActionResultDto Failure(string message)
        {
            return new TradeOfferActionResultDto
            {
                Success = false,
                Message = message,
                Offer = null,
            };
        }

        // -----------------------------------------------------------------
        // Creator-team cap info
        //
        // Bulk-loads, for a set of fantasy teams, the current-season
        // cap hit and the RosterStatus of every player on the team.
        // Both are needed by the frontend to compute the projected
        // cap space after a trade:
        //
        //   - capByTeamId → sum of FantasySalary for Active + Bench
        //                   entries. Prospects excluded (same rule
        //                   as the RosterController's CapSalary).
        //
        //   - statusByTeamAndPlayer → used to skip prospects when
        //                   computing how much an offered player
        //                   actually moves the cap.
        //
        // Both come from a single query, so enriching a full page
        // of offers costs one extra round-trip.
        // -----------------------------------------------------------------

        private sealed class CreatorTeamCapInfo
        {
            public Dictionary<int, decimal> CapByTeamId { get; }
                = new();

            public Dictionary<(int TeamId, int PlayerId), string>
                StatusByTeamAndPlayer
            { get; }
                = new();
        }

        private async Task<CreatorTeamCapInfo> LoadCreatorTeamCapInfoAsync(
            IReadOnlyCollection<int> teamIds,
            CancellationToken ct)
        {
            var result = new CreatorTeamCapInfo();

            if (teamIds.Count == 0)
            {
                return result;
            }

            var season = await _dbContext.Seasons
                .AsNoTracking()
                .OrderByDescending(s => s.StartDate)
                .FirstOrDefaultAsync(ct);

            if (season == null)
            {
                return result;
            }

            var distinctIds = teamIds
                .Distinct()
                .ToList();

            var entries = await _dbContext.RosterEntries
                .AsNoTracking()
                .Where(e =>
                    distinctIds.Contains(e.FantasyTeamId) &&
                    e.SeasonId == season.Id)
                .ToListAsync(ct);

            foreach (var entry in entries)
            {
                var key = (entry.FantasyTeamId, entry.PlayerId);
                result.StatusByTeamAndPlayer[key] =
                    entry.RosterStatus.ToString();

                if (entry.RosterStatus != RosterStatus.Prospect)
                {
                    result.CapByTeamId[entry.FantasyTeamId] =
                        result.CapByTeamId.GetValueOrDefault(
                            entry.FantasyTeamId)
                        + entry.FantasySalary;
                }
            }

            return result;
        }
    }
}