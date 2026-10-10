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
        // Create offer
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

        // -----------------------------------------------------------------
        // List offers
        // -----------------------------------------------------------------

        /// <summary>
        /// Lists active offers visible to the given user. Read-only.
        ///
        /// When includeMine is false, offers the user has already
        /// responded to (with a Pending response) are also excluded, so
        /// he cannot respond twice to the same offer.
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

        // -----------------------------------------------------------------
        // Cancel offer
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
        // Respond to offer
        // -----------------------------------------------------------------

        /// <summary>
        /// Records a response to someone else's offer. The responding
        /// manager must supply one player for every slot of the offer,
        /// each belonging to his own roster and matching the slot's
        /// demanded position group.
        ///
        /// Rejects:
        ///   - responding to your own offer,
        ///   - responding to a non-active offer,
        ///   - responding twice to the same offer while a Pending
        ///     response already exists,
        ///   - a slot without a matching pick,
        ///   - a pick that is not on the responder's roster,
        ///   - a pick whose position group does not match the slot.
        /// </summary>
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

        // -----------------------------------------------------------------
        // List received responses
        // -----------------------------------------------------------------

        /// <summary>
        /// Lists every Pending response to a still-active offer that the
        /// given user created. This is exactly what the "Offres reçues"
        /// section shows.
        /// </summary>
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
     .Include(r => r.TradeOffer)
         .ThenInclude(o => o.CreatedByFantasyTeam)
     .Include(r => r.RespondingFantasyTeam)
     .Include(r => r.Slots)
         .ThenInclude(s => s.RespondingPlayer)
             .ThenInclude(p => p!.NhlTeam)
                // Include Accepted responses so the creator still sees
                // them in his inbox after accepting. Rejected / Cancelled
                // responses stay hidden.
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

            var respondingPlayerIds = responses
                .SelectMany(r => r.Slots)
                .Select(s => s.RespondingPlayerId)
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
                respondingPlayerIds, ct);

            return responses
     .Select(r => ToResponseDto(r, contractsByPlayerId))
     .ToList();
        }

        // -----------------------------------------------------------------
        // List sent responses
        // -----------------------------------------------------------------

        /// <summary>
        /// Lists every Pending response the calling user's team has
        /// submitted to someone else's still-active offer. This is
        /// exactly what the "Offres envoyées" section shows.
        ///
        /// Same shape as ListReceivedResponsesAsync — the DTO carries
        /// both teams' names, so the frontend can pick which name goes
        /// in the header based on the section it is rendering.
        /// </summary>
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
                .Include(r => r.TradeOffer)
                    .ThenInclude(o => o.CreatedByFantasyTeam)
                .Include(r => r.RespondingFantasyTeam)
                .Include(r => r.Slots)
                    .ThenInclude(s => s.RespondingPlayer)
                        .ThenInclude(p => p!.NhlTeam)
                // Include Accepted responses so the sender still sees
                // them in his outbox after the other manager accepts.
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

            var respondingPlayerIds = responses
                .SelectMany(r => r.Slots)
                .Select(s => s.RespondingPlayerId)
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
                respondingPlayerIds, ct);

            return responses
     .Select(r => ToResponseDto(r, contractsByPlayerId))
     .ToList();
        }

        // -----------------------------------------------------------------
        // Accept a response
        // -----------------------------------------------------------------

        /// <summary>
        /// Flips a Pending response to Accepted. Only the offer creator
        /// can accept a response to his own offer. No player movement,
        /// no roster write, no recompute: this is purely a state change
        /// on the response, so both sides see the "ACCEPTÉE" badge on
        /// their respective panels.
        ///
        /// Other Pending responses on the same offer are left alone.
        /// The creator decides whether to accept more than one; the
        /// system does not auto-reject them.
        /// </summary>
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

        private async Task<TradeOfferResponseDto?> LoadResponseDtoAsync(
            int responseId,
            CancellationToken ct)
        {
            var response = await _dbContext.TradeOfferResponses
      .AsNoTracking()
      .Include(r => r.TradeOffer)
          .ThenInclude(o => o.Slots)
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

            var respondingPlayerIds = response.Slots
                .Select(s => s.RespondingPlayerId)
                .Distinct()
                .ToList();

            var contractsByPlayerId = await LoadContractsByPlayerIdAsync(
                respondingPlayerIds, ct);

            return ToResponseDto(response, contractsByPlayerId);
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
                                s.OfferingPlayerId,
                                contractsByPlayerId);

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

        private static TradeOfferResponseDto ToResponseDto(
            TradeOfferResponse response,
            IReadOnlyDictionary<int, List<PlayerContract>> contractsByPlayerId)
        {
            // Index the original offer's slots by SlotIndex so each
            // response slot can pull its demanded position group and
            // filters without re-querying.
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

                        var (current, second) =
                            ResolveContractLinesForSlot(
                                s.RespondingPlayerId,
                                contractsByPlayerId);

                        return new TradeOfferResponseSlotDto
                        {
                            SlotIndex = s.SlotIndex,
                            PositionGroup =
                                offerSlot?.PositionGroup ?? string.Empty,
                            RespondingPlayerId = s.RespondingPlayerId,
                            RespondingPlayerFirstName =
                                s.RespondingPlayer?.FirstName,
                            RespondingPlayerLastName =
                                s.RespondingPlayer?.LastName,
                            RespondingPlayerNhlTeam =
                                s.RespondingPlayer?.NhlTeam?.Abbreviation,
                            RespondingPlayerPosition =
                                s.RespondingPlayer?.Position,
                            RespondingPlayerCurrentContract = current,
                            RespondingPlayerSecondContract = second,
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
    }
}