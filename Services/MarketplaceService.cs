using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Dtos;

namespace NhlFantasyLeague.api.Services
{
    /// <summary>
    /// Business logic for the Marketplace page: create, list and
    /// cancel trade offers between fantasy managers.
    ///
    /// The list endpoint no longer records "seen" markers. That
    /// happens on a separate, delayed call from the frontend so that
    /// a first mount of the browse tab shows the green "Nouvelle
    /// offre" badges without immediately flipping them off on a
    /// StrictMode double-mount.
    /// </summary>
    public class MarketplaceService
    {
        private readonly AppDbContext _dbContext;

        public MarketplaceService(AppDbContext dbContext)
        {
            _dbContext = dbContext;
        }

        // -----------------------------------------------------------------
        // Create
        // -----------------------------------------------------------------

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
                return Failure(
                    "Maximum 10 joueurs par offre.");
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

            // Mark the offer as already seen by its own creator. He
            // obviously knows about it, so he should never see a
            // "Nouvelle offre" badge on his own offer.
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

        // -----------------------------------------------------------------
        // List
        // -----------------------------------------------------------------

        /// <summary>
        /// Lists active offers visible to the given user. Read-only:
        /// does NOT record anything. The frontend is responsible for
        /// calling MarkOffersSeenAsync after the list has been shown
        /// for a short grace period.
        /// </summary>
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
            }

            var offerIds = offers.Select(o => o.Id).ToList();

            // Which of these offers has this user already seen?
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

            return offers
                .Select(o => ToDto(
                    o,
                    userTeamId,
                    contractsByPlayerId,
                    seenIds))
                .ToList();
        }

        // -----------------------------------------------------------------
        // Mark seen
        // -----------------------------------------------------------------

        /// <summary>
        /// Marks the given active offers as seen by the given user.
        /// Idempotent: an already-existing view row is left untouched.
        /// </summary>
        public async Task<int> MarkOffersSeenAsync(
            int userId,
            IReadOnlyCollection<int> rawOfferIds,
            CancellationToken ct = default)
        {
            if (rawOfferIds.Count == 0)
            {
                return 0;
            }

            // Only keep ids that actually refer to existing active
            // offers. Filters out typos, stale ids, and any attempt
            // to grow the TradeOfferViews table with unused rows.
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

        // -----------------------------------------------------------------
        // Cancel
        // -----------------------------------------------------------------

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

        // -----------------------------------------------------------------
        // Helpers
        // -----------------------------------------------------------------

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

            return ToDto(
                offer,
                user?.FantasyTeamId,
                contractsByPlayerId,
                seenOfferIds: null);
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
                TradeOfferSlot slot,
                IReadOnlyDictionary<int, List<PlayerContract>>?
                    contractsByPlayerId)
        {
            if (!slot.OfferingPlayerId.HasValue ||
                contractsByPlayerId == null ||
                !contractsByPlayerId.TryGetValue(
                    slot.OfferingPlayerId.Value, out var contracts) ||
                contracts.Count == 0)
            {
                return (null, null);
            }

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
                Salary = contract.Salary,
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
            IReadOnlySet<int>? seenOfferIds = null)
        {
            return new TradeOfferDto
            {
                Id = offer.Id,
                CreatedByFantasyTeamId = offer.CreatedByFantasyTeamId,
                CreatedByFantasyTeamName =
                    offer.CreatedByFantasyTeam?.Name ?? string.Empty,
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
                                s, contractsByPlayerId);

                        return new TradeOfferSlotDto
                        {
                            SlotIndex = s.SlotIndex,
                            PositionGroup = s.PositionGroup,
                            OfferingPlayerId = s.OfferingPlayerId,
                            OfferingPlayerFirstName =
                                s.OfferingPlayer?.FirstName,
                            OfferingPlayerLastName =
                                s.OfferingPlayer?.LastName,
                            OfferingPlayerNhlTeam =
                                s.OfferingPlayer?.NhlTeam?.Abbreviation,
                            OfferingPlayerPosition =
                                s.OfferingPlayer?.Position,
                            OfferingPlayerCurrentContract = current,
                            OfferingPlayerSecondContract = second,
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
    }
}