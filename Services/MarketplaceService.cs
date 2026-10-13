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

        /// <summary>
        /// Validates the slot list of a trade-offer request against the
        /// calling team's roster for the given season. Returns the
        /// first error message it finds, or null when the request is
        /// valid.
        ///
        /// Shared by CreateOfferAsync and UpdateOfferAsync so the two
        /// endpoints can never drift apart on the offer rules:
        ///   - 1..10 slots,
        ///   - position group is F / D / G,
        ///   - each offered player appears at most once across slots,
        ///   - each offered player is on the calling team for the
        ///     season,
        ///   - the offered player's position group matches the slot's
        ///     demanded position group.
        /// </summary>
        private async Task<string?> ValidateOfferSlotsAsync(
            int teamId,
            int seasonId,
            IList<CreateTradeOfferSlotRequest>? slots,
            CancellationToken ct)
        {
            if (slots == null || slots.Count == 0)
            {
                return "Ajoutez au moins un joueur a votre offre.";
            }

            if (slots.Count > 10)
            {
                return "Maximum 10 joueurs par offre.";
            }

            var rosterEntries = await _dbContext.RosterEntries
                .AsNoTracking()
                .Include(e => e.Player)
                .Where(e =>
                    e.FantasyTeamId == teamId &&
                    e.SeasonId == seasonId)
                .ToListAsync(ct);

            var rosterByPlayerId = rosterEntries
                .GroupBy(e => e.PlayerId)
                .ToDictionary(g => g.Key, g => g.First());

            var seenPlayerIds = new HashSet<int>();

            for (var i = 0; i < slots.Count; i++)
            {
                var slot = slots[i];

                if (!IsValidPositionGroup(slot.PositionGroup))
                {
                    return
                        $"Position invalide a l'emplacement {i + 1}. " +
                        "Utilisez F, D ou G.";
                }

                if (slot.OfferingPlayerId.HasValue)
                {
                    if (!seenPlayerIds.Add(slot.OfferingPlayerId.Value))
                    {
                        return
                            "Le meme joueur ne peut pas apparaitre " +
                            "deux fois dans la meme offre.";
                    }

                    if (!rosterByPlayerId.TryGetValue(
                            slot.OfferingPlayerId.Value,
                            out var entry))
                    {
                        return
                            $"Le joueur {slot.OfferingPlayerId.Value} " +
                            "n'est pas sur votre equipe pour la saison " +
                            "en cours.";
                    }

                    var playerGroup = PositionGroupHelper.Classify(
                        entry.Player?.Position);

                    if (!PositionMatchesGroup(
                            playerGroup, slot.PositionGroup))
                    {
                        return
                            $"La position du joueur " +
                            $"{entry.Player?.FirstName} " +
                            $"{entry.Player?.LastName} ne correspond pas " +
                            $"a la position demandee pour l'emplacement " +
                            $"{i + 1}.";
                    }
                }
            }

            return null;
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

            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
      _dbContext, ct);

            if (season == null)
            {
                return Failure(
                    "Aucune saison active. Lancez POST /api/League/setup.");
            }

            var validationError = await ValidateOfferSlotsAsync(
                teamId, season.Id, request.Slots, ct);

            if (validationError != null)
            {
                return Failure(validationError);
            }

            var (picksError, validPickIds) =
                await ValidateDraftPicksBelongToTeamAsync(
                    teamId, request.DraftPickIds, ct);

            if (picksError != null)
            {
                return Failure(picksError);
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
                    EnforceDemandMinContractYears =
           slot.EnforceDemandMinContractYears,
                    EnforceDemandMaxSalary =
           slot.EnforceDemandMaxSalary,
                    EnforceDemandMaxAge =
           slot.EnforceDemandMaxAge,
                    EnforceDemandMinPointsLastYear =
           slot.EnforceDemandMinPointsLastYear,
                });
            }

            foreach (var pickId in validPickIds!)
            {
                offer.Picks.Add(new TradeOfferPick
                {
                    DraftPickId = pickId,
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

        /// <summary>
        /// Replaces the slot list, the pick list and the note of an
        /// existing offer owned by the calling team.
        ///
        /// IDENTITY IS PRESERVED: the TradeOffer row itself is not
        /// deleted and re-created, so its Id, its CreatedAt, and every
        /// per-user "seen" marker stay valid. On the browse list the
        /// modified offer keeps its position and does not pop up as
        /// "Nouvelle offre" again.
        ///
        /// REFUSES TO EDIT WHEN A RESPONSE IS IN FLIGHT: if any
        /// Pending or Accepted response exists on the offer, the
        /// update is refused. Replacing the offered players, the
        /// demand criteria or the offered picks underneath a
        /// responder would silently invalidate the picks they already
        /// submitted, and the correct fix is to cancel the offer and
        /// publish a new one.
        ///
        /// Rejected / Cancelled responses are left in place as
        /// historical rows — every panel filters them out, so they
        /// never appear to any user.
        /// </summary>
        public async Task<TradeOfferActionResultDto> UpdateOfferAsync(
            int userId,
            int offerId,
            CreateTradeOfferRequest request,
            CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour modifier une offre.");
            }

            var teamId = user.FantasyTeamId.Value;

            var offer = await _dbContext.TradeOffers
                .Include(o => o.Slots)
                .Include(o => o.Picks)
                .FirstOrDefaultAsync(o => o.Id == offerId, ct);

            if (offer == null)
            {
                return Failure("Offre introuvable.");
            }

            if (offer.CreatedByFantasyTeamId != teamId)
            {
                return Failure(
                    "Vous ne pouvez modifier que vos propres offres.");
            }

            if (offer.Status != TradeOfferStatus.Active)
            {
                return Failure("Cette offre n'est plus active.");
            }

            var blockingResponses = await _dbContext.TradeOfferResponses
                .AsNoTracking()
                .CountAsync(r =>
                    r.TradeOfferId == offerId &&
                    (r.Status == TradeOfferResponseStatus.Pending ||
                     r.Status == TradeOfferResponseStatus.Accepted), ct);

            if (blockingResponses > 0)
            {
                return Failure(
                    "Cette offre a deja recu une reponse. " +
                    "Annulez-la et publiez-en une nouvelle pour la " +
                    "modifier.");
            }

            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
       _dbContext, ct);

            if (season == null)
            {
                return Failure(
                    "Aucune saison active. Lancez POST /api/League/setup.");
            }

            var validationError = await ValidateOfferSlotsAsync(
                teamId, season.Id, request.Slots, ct);

            if (validationError != null)
            {
                return Failure(validationError);
            }

            var (picksError, validPickIds) =
                await ValidateDraftPicksBelongToTeamAsync(
                    teamId, request.DraftPickIds, ct);

            if (picksError != null)
            {
                return Failure(picksError);
            }

            // Replace the slots in place. Materialize the current
            // collection before removing so we can mutate it while
            // iterating. EF Core orders the DELETEs before the
            // INSERTs within the same SaveChanges, so the unique
            // index on (TradeOfferId, SlotIndex) stays satisfied
            // throughout the transaction.
            var oldSlots = offer.Slots.ToList();
            _dbContext.TradeOfferSlots.RemoveRange(oldSlots);
            offer.Slots.Clear();

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
                    EnforceDemandMinContractYears =
           slot.EnforceDemandMinContractYears,
                    EnforceDemandMaxSalary =
           slot.EnforceDemandMaxSalary,
                    EnforceDemandMaxAge =
           slot.EnforceDemandMaxAge,
                    EnforceDemandMinPointsLastYear =
           slot.EnforceDemandMinPointsLastYear,
                });
            }

            // Same treatment for picks: materialize, remove, then
            // re-add from the request. The unique index on
            // (TradeOfferId, DraftPickId) is satisfied because EF
            // orders the DELETEs first.
            var oldPicks = offer.Picks.ToList();
            _dbContext.TradeOfferPicks.RemoveRange(oldPicks);
            offer.Picks.Clear();

            foreach (var pickId in validPickIds!)
            {
                offer.Picks.Add(new TradeOfferPick
                {
                    DraftPickId = pickId,
                });
            }

            offer.Note = string.IsNullOrWhiteSpace(request.Note)
                ? null
                : request.Note.Trim();

            await _dbContext.SaveChangesAsync(ct);

            var reloaded = await LoadOfferDtoAsync(offer.Id, userId, ct);

            if (reloaded == null)
            {
                return Failure(
                    "Offre modifiee mais impossible de la recharger.");
            }

            return new TradeOfferActionResultDto
            {
                Success = true,
                Message = "Offre modifiee.",
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
        .Include(o => o.Season)
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

            var picksByOfferId = await LoadOfferPicksByOfferIdAsync(
                offerIds, ct);

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
                    creatorTeamCapInfo,
                    picksByOfferId))
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

        /// <summary>
        /// Returns the count of unseen offers and unseen received
        /// responses for the given user. This is what the navbar
        /// notification badge renders.
        ///
        /// "Unseen offer" = an ACTIVE offer not created by the
        /// user's team, that the user has never had in view on the
        /// browse tab (no TradeOfferView row), and that the user
        /// has not already responded to (a Pending response means
        /// the offer is hidden from browse and should not be
        /// counted).
        ///
        /// "Unseen response" = a PENDING response on an offer the
        /// user's team created, that the user has never had in
        /// view on the received tab (no TradeOfferResponseView
        /// row). Accepted responses are never counted: they were
        /// acted on, which means they were seen.
        ///
        /// The two counts are independent; Total is the sum and is
        /// the number the badge renders.
        /// </summary>
        public async Task<MarketplaceNotificationCountDto>
            GetNotificationCountAsync(
                int userId,
                CancellationToken ct = default)
        {
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return new MarketplaceNotificationCountDto();
            }

            var myTeamId = user.FantasyTeamId.Value;

            // --- Unseen offers --------------------------------------------
            var seenOfferIds = _dbContext.TradeOfferViews
                .Where(v => v.UserId == userId)
                .Select(v => v.TradeOfferId);

            var respondedOfferIds = _dbContext.TradeOfferResponses
                .Where(r =>
                    r.RespondingFantasyTeamId == myTeamId &&
                    r.Status == TradeOfferResponseStatus.Pending)
                .Select(r => r.TradeOfferId);

            var unseenOffers = await _dbContext.TradeOffers
                .AsNoTracking()
                .Where(o =>
                    o.Status == TradeOfferStatus.Active &&
                    o.CreatedByFantasyTeamId != myTeamId &&
                    !seenOfferIds.Contains(o.Id) &&
                    !respondedOfferIds.Contains(o.Id))
                .CountAsync(ct);

            // --- Unseen responses -----------------------------------------
            var seenResponseIds = _dbContext.TradeOfferResponseViews
                .Where(v => v.UserId == userId)
                .Select(v => v.TradeOfferResponseId);

            var unseenResponses = await _dbContext.TradeOfferResponses
                .AsNoTracking()
                .Where(r =>
                    r.Status == TradeOfferResponseStatus.Pending &&
                    r.TradeOffer.CreatedByFantasyTeamId == myTeamId &&
                    !seenResponseIds.Contains(r.Id))
                .CountAsync(ct);

            return new MarketplaceNotificationCountDto
            {
                UnseenOffers = unseenOffers,
                UnseenResponses = unseenResponses,
                Total = unseenOffers + unseenResponses,
            };
        }

        /// <summary>
        /// Records that the calling user has seen the given
        /// responses on his Reçues tab. Idempotent: responses the
        /// user already saw are skipped. Responses on offers the
        /// user did not create are silently filtered out so a
        /// caller cannot mark someone else's responses as seen.
        ///
        /// Returns the number of view rows inserted.
        /// </summary>
        public async Task<int> MarkResponsesSeenAsync(
            int userId,
            IReadOnlyCollection<int> rawResponseIds,
            CancellationToken ct = default)
        {
            if (rawResponseIds.Count == 0)
            {
                return 0;
            }

            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return 0;
            }

            var myTeamId = user.FantasyTeamId.Value;

            // Only responses on offers the user created are valid
            // candidates. This is the authorization check: a user
            // cannot mark someone else's responses as seen.
            var validResponseIds = await _dbContext.TradeOfferResponses
                .AsNoTracking()
                .Where(r =>
                    rawResponseIds.Contains(r.Id) &&
                    r.TradeOffer.CreatedByFantasyTeamId == myTeamId)
                .Select(r => r.Id)
                .ToListAsync(ct);

            if (validResponseIds.Count == 0)
            {
                return 0;
            }

            var alreadySeen = await _dbContext.TradeOfferResponseViews
                .Where(v =>
                    v.UserId == userId &&
                    validResponseIds.Contains(v.TradeOfferResponseId))
                .Select(v => v.TradeOfferResponseId)
                .ToListAsync(ct);

            var seenSet = alreadySeen.ToHashSet();
            var now = DateTime.UtcNow;
            var inserted = 0;

            foreach (var id in validResponseIds)
            {
                if (seenSet.Contains(id))
                {
                    continue;
                }

                _dbContext.TradeOfferResponseViews.Add(
                    new TradeOfferResponseView
                    {
                        UserId = userId,
                        TradeOfferResponseId = id,
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

            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
        _dbContext, ct);

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

            // Validate the responding team's draft picks. Every id
            // must reference a pick whose CURRENT owner is the
            // responding team.
            var (picksError, validPickIds) =
                await ValidateDraftPicksBelongToTeamAsync(
                    respondingTeamId, request.DraftPickIds, ct);

            if (picksError != null)
            {
                return Failure(picksError);
            }

            // Validate the REQUESTED draft picks. These belong to
            // the offer's creator (the responding team is asking
            // the creator to give them), not to the responder.
            var (requestedError, validRequestedIds) =
                await ValidateDraftPicksBelongToTeamAsync(
                    offer.CreatedByFantasyTeamId,
                    request.RequestedDraftPickIds,
                    ct);

            if (requestedError != null)
            {
                return Failure(requestedError);
            }

            // A requested pick must not already be in the offer's
            // own pick list — the responder should not be able to
            // "request" what is already offered, it would double-
            // count on accept.
            if (validRequestedIds != null && validRequestedIds.Count > 0)
            {
                var offerPickIds = await _dbContext.TradeOfferPicks
                    .AsNoTracking()
                    .Where(p => p.TradeOfferId == offerId)
                    .Select(p => p.DraftPickId)
                    .ToListAsync(ct);

                var overlap = validRequestedIds
                    .Intersect(offerPickIds)
                    .ToList();

                if (overlap.Count > 0)
                {
                    return Failure(
                        "Un choix de repêchage demandé fait déjà " +
                        "partie de l'offre originale.");
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

            foreach (var pickId in validPickIds!)
            {
                response.Picks.Add(new TradeOfferResponsePick
                {
                    DraftPickId = pickId,
                });
            }

            foreach (var pickId in validRequestedIds!)
            {
                response.RequestedPicks.Add(
                    new TradeOfferResponseRequestedPick
                    {
                        DraftPickId = pickId,
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

        /// <summary>
        /// Creates a direct offer from the calling user's team to a
        /// specific target team. Unlike the marketplace flow, BOTH
        /// sides of the trade are already decided at submit time.
        ///
        /// Implementation strategy: the target team is stored as the
        /// TradeOffer's creator, and the calling user's team is
        /// stored as the TradeOfferResponse's responder. This mapping
        /// is the only one that makes the proposal actionable on
        /// both ends:
        ///
        ///   - TradeOffer.CreatedByFantasyTeamId == target team
        ///     ⟹ the offer shows up in the target team's
        ///        "Offres reçues", which is where Accept / Reject
        ///        live.
        ///
        ///   - TradeOfferResponse.RespondingFantasyTeamId ==
        ///     calling user's team ⟹ the response shows up in the
        ///     calling user's "Offres envoyées", which is where
        ///     Cancel lives.
        ///
        /// The semantics are slightly off (the target manager
        /// appears as the offer's creator even though he did not
        /// create it), but the alternative — putting the calling
        /// user as the creator — would leave the proposal stuck in
        /// the wrong inbox on both sides.
        ///
        /// Everything is written in one SaveChanges for the offer
        /// and one for the response, so a failure never leaves a
        /// dangling offer with no response.
        /// </summary>
        public async Task<TradeOfferActionResultDto> CreateDirectOfferAsync(
      int userId,
      CreateDirectOfferRequest request,
      CancellationToken ct = default)
        {
            // ---- 1. Resolve the calling user's team ------------------
            var user = await _dbContext.Users
                .AsNoTracking()
                .FirstOrDefaultAsync(u => u.Id == userId, ct);

            if (user?.FantasyTeamId == null)
            {
                return Failure(
                    "Vous devez avoir une equipe pour envoyer une offre.");
            }

            var connectedTeamId = user.FantasyTeamId.Value;

            if (request.TargetTeamId == connectedTeamId)
            {
                return Failure(
                    "Vous ne pouvez pas vous envoyer une offre a " +
                    "vous-meme.");
            }

            // ---- 2. Target team must exist ---------------------------
            var targetTeam = await _dbContext.FantasyTeams
                .AsNoTracking()
                .FirstOrDefaultAsync(
                    t => t.Id == request.TargetTeamId, ct);

            if (targetTeam == null)
            {
                return Failure("L'equipe cible est introuvable.");
            }

            // ---- 3. Slot shape ---------------------------------------
            if (request.Slots == null || request.Slots.Count == 0)
            {
                return Failure(
                    "Ajoutez au moins un joueur a votre offre.");
            }

            if (request.Slots.Count > 10)
            {
                return Failure("Maximum 10 joueurs par offre.");
            }

            // ---- 4. Current season -----------------------------------
            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
          _dbContext, ct);

            if (season == null)
            {
                return Failure(
                    "Aucune saison active. Lancez POST /api/League/setup.");
            }

            // ---- 5. Rosters for both sides ---------------------------
            var connectedRoster = await _dbContext.RosterEntries
                .AsNoTracking()
                .Include(e => e.Player)
                .Where(e =>
                    e.FantasyTeamId == connectedTeamId &&
                    e.SeasonId == season.Id)
                .ToListAsync(ct);

            var targetRoster = await _dbContext.RosterEntries
                .AsNoTracking()
                .Include(e => e.Player)
                .Where(e =>
                    e.FantasyTeamId == request.TargetTeamId &&
                    e.SeasonId == season.Id)
                .ToListAsync(ct);

            var connectedByPlayerId = connectedRoster
                .GroupBy(e => e.PlayerId)
                .ToDictionary(g => g.Key, g => g.First());

            var targetByPlayerId = targetRoster
                .GroupBy(e => e.PlayerId)
                .ToDictionary(g => g.Key, g => g.First());

            // ---- 6. Validate each slot -------------------------------
            var seenConnected = new HashSet<int>();
            var seenTarget = new HashSet<int>();

            for (var i = 0; i < request.Slots.Count; i++)
            {
                var slot = request.Slots[i];

                if (!seenConnected.Add(slot.ConnectedPlayerId))
                {
                    return Failure(
                        "Le meme joueur ne peut pas apparaitre deux " +
                        "fois dans votre offre.");
                }

                if (!seenTarget.Add(slot.TargetPlayerId))
                {
                    return Failure(
                        "Le meme joueur de l'equipe cible ne peut pas " +
                        "apparaitre deux fois dans l'offre.");
                }

                if (!connectedByPlayerId.TryGetValue(
                        slot.ConnectedPlayerId, out var connectedEntry))
                {
                    return Failure(
                        $"Le joueur {slot.ConnectedPlayerId} n'est " +
                        "pas sur votre equipe pour la saison en cours.");
                }

                if (!targetByPlayerId.TryGetValue(
                        slot.TargetPlayerId, out var targetEntry))
                {
                    return Failure(
                        $"Le joueur {slot.TargetPlayerId} n'est pas " +
                        "sur l'equipe cible pour la saison en cours.");
                }

                var connectedGroup = PositionGroupHelper.Classify(
                    connectedEntry.Player?.Position);

                var targetGroup = PositionGroupHelper.Classify(
                    targetEntry.Player?.Position);

                if (connectedGroup != targetGroup)
                {
                    return Failure(
                        $"Les joueurs de l'emplacement {i + 1} ne " +
                        "jouent pas a la meme position.");
                }
            }

            // ---- 6b. Validate both sides' draft picks ----------------
            // Connected picks must belong to the connected team;
            // target picks must belong to the target team.
            var (connectedPicksError, connectedPickIds) =
                await ValidateDraftPicksBelongToTeamAsync(
                    connectedTeamId, request.ConnectedDraftPickIds, ct);

            if (connectedPicksError != null)
            {
                return Failure(connectedPicksError);
            }

            var (targetPicksError, targetPickIds) =
                await ValidateDraftPicksBelongToTeamAsync(
                    request.TargetTeamId, request.TargetDraftPickIds, ct);

            if (targetPicksError != null)
            {
                return Failure(targetPicksError);
            }

            // ---- 7. Create the TradeOffer ----------------------------
            // Creator = target team (see the method doc for why).
            // Offering players = the TARGET team's players, because
            // they are what the offer's "left" side displays.
            // Offering picks = the TARGET team's picks, same rule.
            var offer = new TradeOffer
            {
                CreatedByFantasyTeamId = request.TargetTeamId,
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
                var targetEntry = targetByPlayerId[slot.TargetPlayerId];
                var targetGroup = PositionGroupHelper.Classify(
                    targetEntry.Player?.Position);

                offer.Slots.Add(new TradeOfferSlot
                {
                    SlotIndex = i,
                    PositionGroup = PositionGroupToCode(targetGroup),
                    OfferingPlayerId = slot.TargetPlayerId,
                    DemandMinContractYears = null,
                    DemandMaxSalary = null,
                    DemandMaxAge = null,
                    DemandMinPointsLastYear = null,
                    EnforceDemandMinContractYears = true,
                    EnforceDemandMaxSalary = true,
                    EnforceDemandMaxAge = true,
                    EnforceDemandMinPointsLastYear = true,
                });
            }

            foreach (var pickId in targetPickIds!)
            {
                offer.Picks.Add(new TradeOfferPick
                {
                    DraftPickId = pickId,
                });
            }

            _dbContext.TradeOffers.Add(offer);
            await _dbContext.SaveChangesAsync(ct);

            // ---- 8. Create the TradeOfferResponse --------------------
            // Responder = connected user's team. Responding players =
            // the CONNECTED user's players. Responding picks = the
            // CONNECTED user's picks, same rule.
            var response = new TradeOfferResponse
            {
                TradeOfferId = offer.Id,
                RespondingFantasyTeamId = connectedTeamId,
                CreatedAt = DateTime.UtcNow,
                Status = TradeOfferResponseStatus.Pending,
            };

            for (var i = 0; i < request.Slots.Count; i++)
            {
                var slot = request.Slots[i];

                response.Slots.Add(new TradeOfferResponseSlot
                {
                    SlotIndex = i,
                    RespondingPlayerId = slot.ConnectedPlayerId,
                });
            }

            foreach (var pickId in connectedPickIds!)
            {
                response.Picks.Add(new TradeOfferResponsePick
                {
                    DraftPickId = pickId,
                });
            }

            _dbContext.TradeOfferResponses.Add(response);
            await _dbContext.SaveChangesAsync(ct);

            // ---- 9. Reload and return --------------------------------
            var dto = await LoadResponseDtoAsync(response.Id, ct);

            if (dto == null)
            {
                return Failure(
                    "Offre creee mais impossible de la recharger.");
            }

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
.Include(r => r.TradeOffer)
.ThenInclude(o => o.Season)
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

            // Draft picks: the offer's creator-side picks, and the
            // response's responder-side picks. Two queries.
            var offerIds = responses
                .Select(r => r.TradeOfferId)
                .Distinct()
                .ToList();

            var responseIds = responses
                .Select(r => r.Id)
                .Distinct()
                .ToList();

            var offerPicksByOfferId =
       await LoadOfferPicksByOfferIdAsync(offerIds, ct);

            var responsePicksByResponseId =
                await LoadResponsePicksByResponseIdAsync(responseIds, ct);

            var requestedPicksByResponseId =
                await LoadRequestedPicksByResponseIdAsync(
                    responseIds, ct);

            // Cap info for both sides of every response.
            var teamIds = responses
                .Select(r => r.TradeOffer.CreatedByFantasyTeamId)
                .Concat(responses.Select(r => r.RespondingFantasyTeamId))
                .Distinct()
                .ToList();

            var teamCapInfo = await LoadCreatorTeamCapInfoAsync(
                teamIds, ct);

            // Per-user "seen" markers for this response set. Only
            // the ones we are about to render matter.
            var seenResponseIds = (await _dbContext
                .TradeOfferResponseViews
                .AsNoTracking()
                .Where(v =>
                    v.UserId == userId &&
                    responseIds.Contains(v.TradeOfferResponseId))
                .Select(v => v.TradeOfferResponseId)
                .ToListAsync(ct))
                .ToHashSet();

            return responses
     .Select(r => ToResponseDto(
         r,
         contractsByPlayerId,
         statsByPlayerId,
         teamCapInfo,
         offerPicksByOfferId,
         responsePicksByResponseId,
         requestedPicksByResponseId,
         seenResponseIds))
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
.Include(r => r.TradeOffer)
.ThenInclude(o => o.Season)
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

            // Draft picks: same shape as ListReceivedResponsesAsync.
            var offerIds = responses
                .Select(r => r.TradeOfferId)
                .Distinct()
                .ToList();

            var responseIds = responses
                .Select(r => r.Id)
                .Distinct()
                .ToList();

            var offerPicksByOfferId =
       await LoadOfferPicksByOfferIdAsync(offerIds, ct);

            var responsePicksByResponseId =
                await LoadResponsePicksByResponseIdAsync(responseIds, ct);

            var requestedPicksByResponseId =
                await LoadRequestedPicksByResponseIdAsync(
                    responseIds, ct);

            // Cap info for both sides of every response. One query,
            // covers every team that appears.
            var teamIds = responses
                .Select(r => r.TradeOffer.CreatedByFantasyTeamId)
                .Concat(responses.Select(r => r.RespondingFantasyTeamId))
                .Distinct()
                .ToList();

            var teamCapInfo = await LoadCreatorTeamCapInfoAsync(
                teamIds, ct);

            return responses
     .Select(r => ToResponseDto(
         r,
         contractsByPlayerId,
         statsByPlayerId,
         teamCapInfo,
         offerPicksByOfferId,
         responsePicksByResponseId,
         requestedPicksByResponseId))
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

            if (responses.Count == 0)
            {
                return new List<AdminAcceptedTradeDto>();
            }

            var offerIds = responses
                .Select(r => r.TradeOfferId)
                .Distinct()
                .ToList();

            var responseIds = responses
                .Select(r => r.Id)
                .Distinct()
                .ToList();

            var offerPicksByOfferId =
       await LoadOfferPicksByOfferIdAsync(offerIds, ct);

            var responsePicksByResponseId =
                await LoadResponsePicksByResponseIdAsync(responseIds, ct);

            var requestedPicksByResponseId =
                await LoadRequestedPicksByResponseIdAsync(
                    responseIds, ct);

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

                        OfferCreatorPicks = offerPicksByOfferId
                            .GetValueOrDefault(r.TradeOfferId)
                            ?? new List<DraftPickDto>(),

                        RequestedPicks = requestedPicksByResponseId
                            .GetValueOrDefault(r.Id)
                            ?? new List<DraftPickDto>(),

                        RespondingPicks = responsePicksByResponseId
                            .GetValueOrDefault(r.Id)
                            ?? new List<DraftPickDto>(),
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
     .Include(o => o.Season)
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

            var picksByOfferId = await LoadOfferPicksByOfferIdAsync(
                new[] { offer.Id }, ct);

            var creatorTeamCapInfo = await LoadCreatorTeamCapInfoAsync(
                new[] { offer.CreatedByFantasyTeamId },
                ct);

            return ToDto(
                offer,
                user?.FantasyTeamId,
                contractsByPlayerId,
                statsByPlayerId,
                seenOfferIds: null,
                creatorTeamCapInfo,
                picksByOfferId);
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
     .Include(r => r.TradeOffer)
         .ThenInclude(o => o.Season)
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

            var offerPicksByOfferId = await LoadOfferPicksByOfferIdAsync(
      new[] { response.TradeOfferId }, ct);

            var responsePicksByResponseId =
                await LoadResponsePicksByResponseIdAsync(
                    new[] { response.Id }, ct);

            var requestedPicksByResponseId =
                await LoadRequestedPicksByResponseIdAsync(
                    new[] { response.Id }, ct);

            var teamCapInfo = await LoadCreatorTeamCapInfoAsync(
                new[]
                {
                    response.TradeOffer.CreatedByFantasyTeamId,
                    response.RespondingFantasyTeamId,
                },
                ct);

            return ToResponseDto(
                response,
                contractsByPlayerId,
                statsByPlayerId,
                teamCapInfo,
                offerPicksByOfferId,
                responsePicksByResponseId,
                requestedPicksByResponseId);
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

        // -----------------------------------------------------------------
        // Draft pick helpers (Marketplace)
        //
        // Draft picks are attached to offers and responses by
        // reference, never by transfer. See TradeOfferPick /
        // TradeOfferResponsePick for the rationale.
        // -----------------------------------------------------------------

        /// <summary>
        /// Maps a DraftPick entity to its DTO. Same shape as
        /// DraftPickController.GetTeamDraftPicks so the marketplace
        /// and the Mon équipe page render picks identically.
        /// </summary>
        private static DraftPickDto ToDraftPickDto(DraftPick p)
        {
            return new DraftPickDto
            {
                Id = p.Id,
                DraftId = p.DraftId,
                DraftYear = p.Draft.Season.NhlSeasonCode / 10000,
                NhlSeasonCode = p.Draft.Season.NhlSeasonCode,
                SeasonName = p.Draft.Season.Name,
                Round = p.Round,
                PickNumber = p.PickNumber,
                OriginalOwnerFantasyTeamId =
                    p.OriginalOwnerFantasyTeamId,
                OriginalOwnerFantasyTeamName =
                    p.OriginalOwnerFantasyTeam?.Name ?? string.Empty,
                CurrentOwnerFantasyTeamId =
                    p.CurrentOwnerFantasyTeamId,
                IsOriginallyOwned =
                    p.OriginalOwnerFantasyTeamId ==
                    p.CurrentOwnerFantasyTeamId,
            };
        }

        /// <summary>
        /// Bulk-loads the draft picks attached to a set of offers,
        /// keyed by TradeOfferId. Ordering is stable: year, then
        /// round, then pick number.
        /// </summary>
        private async Task<Dictionary<int, List<DraftPickDto>>>
            LoadOfferPicksByOfferIdAsync(
                IReadOnlyCollection<int> offerIds,
                CancellationToken ct)
        {
            if (offerIds.Count == 0)
            {
                return new Dictionary<int, List<DraftPickDto>>();
            }

            var rows = await _dbContext.TradeOfferPicks
                .AsNoTracking()
                .Where(p => offerIds.Contains(p.TradeOfferId))
                .Include(p => p.DraftPick)
                    .ThenInclude(d => d.Draft)
                        .ThenInclude(d => d.Season)
                .Include(p => p.DraftPick)
                    .ThenInclude(d => d.OriginalOwnerFantasyTeam)
                .ToListAsync(ct);

            return rows
                .GroupBy(r => r.TradeOfferId)
                .ToDictionary(
                    g => g.Key,
                    g => g
                        .Select(r => ToDraftPickDto(r.DraftPick))
                        .OrderBy(p => p.NhlSeasonCode)
                        .ThenBy(p => p.Round)
                        .ThenBy(p => p.PickNumber)
                        .ToList());
        }

        /// <summary>
        /// Bulk-loads the draft picks attached to a set of responses,
        /// keyed by TradeOfferResponseId. Ordering is the same as
        /// <see cref="LoadOfferPicksByOfferIdAsync"/>.
        /// </summary>
        private async Task<Dictionary<int, List<DraftPickDto>>>
            LoadResponsePicksByResponseIdAsync(
                IReadOnlyCollection<int> responseIds,
                CancellationToken ct)
        {
            if (responseIds.Count == 0)
            {
                return new Dictionary<int, List<DraftPickDto>>();
            }

            var rows = await _dbContext.TradeOfferResponsePicks
                .AsNoTracking()
                .Where(p => responseIds.Contains(p.TradeOfferResponseId))
                .Include(p => p.DraftPick)
                    .ThenInclude(d => d.Draft)
                        .ThenInclude(d => d.Season)
                .Include(p => p.DraftPick)
                    .ThenInclude(d => d.OriginalOwnerFantasyTeam)
                .ToListAsync(ct);

            return rows
      .GroupBy(r => r.TradeOfferResponseId)
      .ToDictionary(
          g => g.Key,
          g => g
              .Select(r => ToDraftPickDto(r.DraftPick))
              .OrderBy(p => p.NhlSeasonCode)
              .ThenBy(p => p.Round)
              .ThenBy(p => p.PickNumber)
              .ToList());
        }

        /// <summary>
        /// Bulk-loads the draft picks the responder requested from
        /// the offer's creator, keyed by TradeOfferResponseId.
        /// Same ordering rule as the other pick loaders.
        /// </summary>
        private async Task<Dictionary<int, List<DraftPickDto>>>
            LoadRequestedPicksByResponseIdAsync(
                IReadOnlyCollection<int> responseIds,
                CancellationToken ct)
        {
            if (responseIds.Count == 0)
            {
                return new Dictionary<int, List<DraftPickDto>>();
            }

            var rows = await _dbContext.TradeOfferResponseRequestedPicks
                .AsNoTracking()
                .Where(p => responseIds.Contains(p.TradeOfferResponseId))
                .Include(p => p.DraftPick)
                    .ThenInclude(d => d.Draft)
                        .ThenInclude(d => d.Season)
                .Include(p => p.DraftPick)
                    .ThenInclude(d => d.OriginalOwnerFantasyTeam)
                .ToListAsync(ct);

            return rows
                .GroupBy(r => r.TradeOfferResponseId)
                .ToDictionary(
                    g => g.Key,
                    g => g
                        .Select(r => ToDraftPickDto(r.DraftPick))
                        .OrderBy(p => p.NhlSeasonCode)
                        .ThenBy(p => p.Round)
                        .ThenBy(p => p.PickNumber)
                        .ToList());
        }

        /// <summary>
        /// Validates a list of draft pick ids for a given team:
        ///
        ///   - No duplicates in the incoming list.
        ///   - Every id references an existing DraftPick whose
        ///     CurrentOwnerFantasyTeamId is the given team. Ownership
        ///     is checked against the CURRENT owner, not the
        ///     original owner — a pick that was traded away cannot
        ///     be offered by its old owner.
        ///   - At most 20 picks in one list.
        ///
        /// Returns (null, the de-duplicated ordered ids) on success,
        /// or (a French error message, null) on failure.
        /// </summary>
        private async Task<(string? Error, List<int>? ValidIds)>
            ValidateDraftPicksBelongToTeamAsync(
                int teamId,
                IList<int>? draftPickIds,
                CancellationToken ct)
        {
            if (draftPickIds == null || draftPickIds.Count == 0)
            {
                return (null, new List<int>());
            }

            if (draftPickIds.Count > 20)
            {
                return (
                    "Maximum 20 choix de repêchage par transaction.",
                    null);
            }

            var distinct = draftPickIds.Distinct().ToList();

            if (distinct.Count != draftPickIds.Count)
            {
                return (
                    "Le même choix de repêchage ne peut pas apparaître " +
                    "deux fois.",
                    null);
            }

            var owned = await _dbContext.DraftPicks
                .AsNoTracking()
                .Where(p =>
                    distinct.Contains(p.Id) &&
                    p.CurrentOwnerFantasyTeamId == teamId)
                .Select(p => p.Id)
                .ToListAsync(ct);

            if (owned.Count != distinct.Count)
            {
                return (
                    "Un ou plusieurs choix de repêchage ne sont pas " +
                    "sur cette équipe.",
                    null);
            }

            return (null, distinct);
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
CreatorTeamCapInfo? creatorTeamCapInfo = null,
IReadOnlyDictionary<int, List<DraftPickDto>>? picksByOfferId = null)
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
                SeasonSalaryCap = offer.Season?.SalaryCap ?? 0m,
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
                            EnforceDemandMinContractYears =
                                s.EnforceDemandMinContractYears,
                            EnforceDemandMaxSalary =
                                s.EnforceDemandMaxSalary,
                            EnforceDemandMaxAge =
                                s.EnforceDemandMaxAge,
                            EnforceDemandMinPointsLastYear =
                                s.EnforceDemandMinPointsLastYear,
                        };
                    })
                    .ToList(),

                Picks = picksByOfferId != null &&
                        picksByOfferId.TryGetValue(offer.Id, out var picks)
                    ? picks
                    : new List<DraftPickDto>(),
            };
        }

        private static TradeOfferResponseDto ToResponseDto(
TradeOfferResponse response,
IReadOnlyDictionary<int, List<PlayerContract>> contractsByPlayerId,
IReadOnlyDictionary<int, PlayerStatLines> statsByPlayerId,
CreatorTeamCapInfo? teamCapInfo = null,
IReadOnlyDictionary<int, List<DraftPickDto>>? offerPicksByOfferId = null,
IReadOnlyDictionary<int, List<DraftPickDto>>? responsePicksByResponseId = null,
IReadOnlyDictionary<int, List<DraftPickDto>>? requestedPicksByResponseId = null,
IReadOnlySet<int>? seenResponseIds = null)
        {
            var offerSlotsByIndex = response.TradeOffer.Slots
                .ToDictionary(s => s.SlotIndex);

            // Resolve both sides' cap hits from the loaded cap map.
            // Null when the caller did not provide cap info.
            decimal? creatorCap = null;
            decimal? responderCap = null;

            if (teamCapInfo != null)
            {
                if (teamCapInfo.CapByTeamId.TryGetValue(
                        response.TradeOffer.CreatedByFantasyTeamId,
                        out var c))
                {
                    creatorCap = c;
                }

                if (teamCapInfo.CapByTeamId.TryGetValue(
                        response.RespondingFantasyTeamId,
                        out var r))
                {
                    responderCap = r;
                }
            }

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
                TradeOfferCreatedByFantasyTeamCapSalary = creatorCap,
                RespondingFantasyTeamId = response.RespondingFantasyTeamId,
                RespondingFantasyTeamName =
                    response.RespondingFantasyTeam?.Name ?? string.Empty,
                RespondingFantasyTeamCapSalary = responderCap,
                SeasonSalaryCap =
                    response.TradeOffer.Season?.SalaryCap ?? 0m,
                CreatedAt = response.CreatedAt,
                Status = response.Status.ToString(),

                // Only Pending responses can be "new". An Accepted
                // response was acted on, which means it was seen.
                // A null seen-set (single-response loader) means
                // "cannot prove unseen" and defaults to false.
                IsNew =
                    response.Status ==
                        TradeOfferResponseStatus.Pending &&
                    seenResponseIds != null &&
                    !seenResponseIds.Contains(response.Id),

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

                CreatorPicks =
                    offerPicksByOfferId != null &&
                    offerPicksByOfferId.TryGetValue(
                        response.TradeOfferId, out var creatorPicks)
                        ? creatorPicks
                        : new List<DraftPickDto>(),

                RequestedPicks =
                    requestedPicksByResponseId != null &&
                    requestedPicksByResponseId.TryGetValue(
                        response.Id, out var requestedPicks)
                        ? requestedPicks
                        : new List<DraftPickDto>(),

                RespondingPicks =
                    responsePicksByResponseId != null &&
                    responsePicksByResponseId.TryGetValue(
                        response.Id, out var respondingPicks)
                        ? respondingPicks
                        : new List<DraftPickDto>(),
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

        /// <summary>
        /// Inverse of <see cref="PositionMatchesGroup"/>: converts a
        /// classified <see cref="PositionGroup"/> back to the single
        /// character code stored on TradeOfferSlot.PositionGroup.
        ///
        /// Unknown positions collapse to "F", matching the frontend's
        /// default and the PositionGroupHelper.Classify convention
        /// that treats unclassifiable skaters as forwards.
        /// </summary>
        private static string PositionGroupToCode(PositionGroup group)
        {
            return group switch
            {
                PositionGroup.Defense => "D",
                PositionGroup.Goalie => "G",
                _ => "F",
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

            var season = await Data.SeasonQueries.GetCurrentSeasonAsync(
      _dbContext, ct);

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