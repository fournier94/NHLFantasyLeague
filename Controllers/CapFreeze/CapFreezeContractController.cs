using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Services;
using NhlFantasyLeague.api.Services.Auth;
using NhlFantasyLeague.api.Services.CapFreeze;
using NhlFantasyLeague.api.Services.NHL;

namespace NhlFantasyLeague.api.Controllers.CapFreeze
{
    [Authorize(Roles = AuthService.CommissionerRole)]
    [ApiController]
    [Route("api/[controller]")]
    public class CapFreezeContractController : ControllerBase
    {
        private readonly CapFreezeContractService _capFreezeContractService;
        private readonly CapFreezePageService _capFreezePageService;
        private readonly AppDbContext _dbContext;

        public CapFreezeContractController(
CapFreezeContractService capFreezeContractService,
CapFreezePageService capFreezePageService,
AppDbContext dbContext)
        {
            _capFreezeContractService = capFreezeContractService;
            _capFreezePageService = capFreezePageService;
            _dbContext = dbContext;
        }

        public class CapFreezePlayerContractReview
        {
            public string Category { get; set; } = string.Empty;
            public string Name { get; set; } = string.Empty;
            public string Slug { get; set; } = string.Empty;
            public string PlayerPageUrl { get; set; } = string.Empty;
            public string Position { get; set; } = string.Empty;

            public bool PageRequestSucceeded { get; set; }

            public int? ExtractedTermYears { get; set; }
            public decimal? ExtractedFirstSalary { get; set; }
            public decimal? ExtractedSecondSalary { get; set; }

            public int GeneratedContractCount { get; set; }

            public List<object> Contracts { get; set; } =
                new List<object>();

            public string? ErrorType { get; set; }
            public string? ErrorMessage { get; set; }
        }

        [HttpGet("capfreeze/test-cap-hits")]
        public IActionResult TestCapHits()
        {
            var capHits =
                _capFreezePageService.TestExtractCapHitsFromRow();

            return Ok(capHits);
        }

        [HttpGet("capfreeze/test-contract-sync")]
        public async Task<IActionResult> TestCapFreezeContractSync(
[FromQuery] string playerSlug,
[FromQuery] int playerId)
        {
            var contracts =
                await _capFreezeContractService.SyncPlayerContractsAsync(
                    playerId,
                    playerSlug);

            return Ok(
                contracts.Select(c => new
                {
                    c.Id,
                    c.PlayerId,
                    c.StartSeason,
                    c.EndSeason,
                    c.Salary
                }));
        }

        [HttpGet("capfreeze/review-player-contracts")]
        public async Task<IActionResult> ReviewCapFreezePlayerContracts(
            [FromQuery] string teamSlug)
        {
            var html =
                await _capFreezePageService.GetCapFreezeTeamPageAsync(
                    teamSlug);

            var forwards =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Forwards");

            var defense =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Defense");

            var goalies =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Goalies");

            var minors =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Non-Roster / Minors");

            var unsignedRfas =
                _capFreezePageService.ExtractCapFreezePlayerLinks(
                    html,
                    "Unsigned RFAs");

            var players =
                forwards
                    .Select(p => new
                    {
                        Player = p,
                        Category = "Forwards"
                    })
                    .Concat(
                        defense.Select(p => new
                        {
                            Player = p,
                            Category = "Defense"
                        }))
                    .Concat(
                        goalies.Select(p => new
                        {
                            Player = p,
                            Category = "Goalies"
                        }))
                    .Concat(
                        minors.Select(p => new
                        {
                            Player = p,
                            Category = "Non-Roster / Minors"
                        }))
                    .Concat(
                        unsignedRfas.Select(p => new
                        {
                            Player = p,
                            Category = "Unsigned RFAs"
                        }))
                    .ToList();

            var results =
                new List<CapFreezePlayerContractReview>();

            foreach (var entry in players)
            {
                var playerPageUrl =
                    $"https://capfreeze.com/players/{entry.Player.Slug}.html";

                try
                {
                    var playerHtml =
                        await _capFreezePageService.GetCapFreezePlayerPageAsync(
                            entry.Player.Slug);

                    var contractData =
                        _capFreezeContractService.ExtractCapFreezeContractData(
                            playerHtml,
                            entry.Player.Name);

                    if (contractData == null)
                    {
                        results.Add(
                            new CapFreezePlayerContractReview
                            {
                                Category = entry.Category,
                                Name = entry.Player.Name,
                                Slug = entry.Player.Slug,
                                PlayerPageUrl = playerPageUrl,
                                Position = entry.Player.Position,
                                PageRequestSucceeded = true,
                                GeneratedContractCount = 0
                            });

                        continue;
                    }

                    var contracts =
                        _capFreezeContractService.BuildPlayerContracts(
                            0,
                            contractData);

                    results.Add(
                        new CapFreezePlayerContractReview
                        {
                            Category = entry.Category,
                            Name = entry.Player.Name,
                            Slug = entry.Player.Slug,
                            PlayerPageUrl = playerPageUrl,
                            Position = entry.Player.Position,
                            PageRequestSucceeded = true,

                            ExtractedTermYears =
                                contractData.TermYears,

                            ExtractedFirstSalary =
                                contractData.FirstSalary,

                            ExtractedSecondSalary =
                                contractData.SecondSalary,

                            GeneratedContractCount =
                                contracts.Count,

                            Contracts =
                                contracts
                                    .Select(c => (object)new
                                    {
                                        StartSeason = c.StartSeason,
                                        EndSeason = c.EndSeason,
                                        Salary = c.Salary
                                    })
                                    .ToList()
                        });
                }
                catch (Exception ex)
                {
                    results.Add(
                        new CapFreezePlayerContractReview
                        {
                            Category = entry.Category,
                            Name = entry.Player.Name,
                            Slug = entry.Player.Slug,
                            PlayerPageUrl = playerPageUrl,
                            Position = entry.Player.Position,
                            PageRequestSucceeded = false,
                            GeneratedContractCount = 0,
                            ErrorType = ex.GetType().Name,
                            ErrorMessage = ex.Message
                        });
                }
            }

            return Ok(new
            {
                TeamSlug = teamSlug,

                TotalPlayers = results.Count,

                SuccessfulPages =
                    results.Count(r => r.PageRequestSucceeded),

                FailedPages =
                    results.Count(r => !r.PageRequestSucceeded),

                ContractExtractionSucceeded =
                    results.Count(r =>
                        r.PageRequestSucceeded &&
                        r.ExtractedTermYears.HasValue),

                ContractExtractionFailed =
                    results.Count(r =>
                        r.PageRequestSucceeded &&
                        !r.ExtractedTermYears.HasValue),

                OneContract =
                    results.Count(r =>
                        r.GeneratedContractCount == 1),

                TwoContracts =
                    results.Count(r =>
                        r.GeneratedContractCount == 2),

                OtherContractCount =
                    results.Count(r =>
                        r.GeneratedContractCount != 1 &&
                        r.GeneratedContractCount != 2),

                Players = results
            });
        }

        // =================================================================
        // Per-contract salary protection ("Salaires protégés")
        // =================================================================

        public class UpsertProtectedSalaryRequest
        {
            public int PlayerContractId { get; set; }
            public decimal ProtectedSalary { get; set; }
            public string? ProtectionNote { get; set; }
        }

        [HttpGet("capfreeze/protected-salaries")]
        public async Task<IActionResult> GetProtectedSalaries(
            CancellationToken ct)
        {
            var rows = await _dbContext.PlayerContracts
                .AsNoTracking()
                .Where(c => c.ProtectedSalary != null)
                .Include(c => c.Player)
                    .ThenInclude(p => p.NhlTeam)
                .OrderBy(c => c.Player!.LastName)
                .ThenBy(c => c.Player!.FirstName)
                .ThenBy(c => c.StartSeason)
                .ToListAsync(ct);

            var result = rows
                .Select(c => new
                {
                    PlayerContractId = c.Id,
                    NhlPlayerId = c.Player!.NhlPlayerId,
                    PlayerName =
                        $"{c.Player.FirstName} {c.Player.LastName}",
                    TeamAbbreviation = c.Player.NhlTeam != null
                        ? c.Player.NhlTeam.Abbreviation
                        : null,
                    c.StartSeason,
                    c.EndSeason,
                    c.Salary,
                    c.ProtectedSalary,
                    c.ProtectionNote
                })
                .ToList();

            return Ok(result);
        }

        [HttpGet("capfreeze/player-contracts/{nhlPlayerId:int}")]
        public async Task<IActionResult> GetPlayerContracts(
            int nhlPlayerId,
            CancellationToken ct)
        {
            var player = await _dbContext.Players
                .AsNoTracking()
                .FirstOrDefaultAsync(p =>
                    p.NhlPlayerId == nhlPlayerId, ct);

            if (player == null)
            {
                return NotFound(new
                {
                    message =
                        $"No player with NhlPlayerId {nhlPlayerId}."
                });
            }

            var contracts = await _dbContext.PlayerContracts
                .AsNoTracking()
                .Where(c => c.PlayerId == player.Id)
                .OrderBy(c => c.StartSeason)
                .Select(c => new
                {
                    PlayerContractId = c.Id,
                    c.StartSeason,
                    c.EndSeason,
                    c.Salary,
                    c.ProtectedSalary,
                    c.ProtectionNote
                })
                .ToListAsync(ct);

            return Ok(contracts);
        }

        [HttpPost("capfreeze/protected-salaries")]
        public async Task<IActionResult> UpsertProtectedSalary(
            [FromBody] UpsertProtectedSalaryRequest request,
            CancellationToken ct)
        {
            if (request.PlayerContractId <= 0)
            {
                return BadRequest(new
                {
                    message = "PlayerContractId is required."
                });
            }

            if (request.ProtectedSalary < 0)
            {
                return BadRequest(new
                {
                    message = "ProtectedSalary must be >= 0."
                });
            }

            var contract = await _dbContext.PlayerContracts
                .FirstOrDefaultAsync(c =>
                    c.Id == request.PlayerContractId, ct);

            if (contract == null)
            {
                return BadRequest(new
                {
                    message =
                        $"No contract with Id {request.PlayerContractId}."
                });
            }

            var trimmedNote =
                string.IsNullOrWhiteSpace(request.ProtectionNote)
                    ? null
                    : request.ProtectionNote.Trim();

            if (trimmedNote != null && trimmedNote.Length > 500)
            {
                trimmedNote = trimmedNote.Substring(0, 500);
            }

            contract.ProtectedSalary = request.ProtectedSalary;
            contract.ProtectionNote = trimmedNote;

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new
            {
                PlayerContractId = contract.Id,
                contract.StartSeason,
                contract.EndSeason,
                contract.Salary,
                contract.ProtectedSalary,
                contract.ProtectionNote
            });
        }

        [HttpDelete("capfreeze/protected-salaries/{playerContractId:int}")]
        public async Task<IActionResult> DeleteProtectedSalary(
            int playerContractId,
            CancellationToken ct)
        {
            var contract = await _dbContext.PlayerContracts
                .FirstOrDefaultAsync(c =>
                    c.Id == playerContractId, ct);

            if (contract == null)
            {
                return NotFound(new
                {
                    message =
                        $"No contract with Id {playerContractId}."
                });
            }

            contract.ProtectedSalary = null;
            contract.ProtectionNote = null;

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new { message = "Protection removed." });
        }

        // =================================================================
        // Manual contracts ("Contrats manuels")
        //
        // A player flagged with SkipCapFreezeSync=true is never touched
        // by the CapFreeze sync. All of his contract rows are managed
        // through these endpoints. Used for players whose CapFreeze
        // data cannot be trusted (the two Elias Pettersson records are
        // the canonical case).
        // =================================================================

        public class SetPlayerSkipCapFreezeRequest
        {
            public int NhlPlayerId { get; set; }
            public bool Skip { get; set; }
        }

        public class CreateManualContractRequest
        {
            public int NhlPlayerId { get; set; }
            public int StartSeason { get; set; }
            public int EndSeason { get; set; }
            public decimal Salary { get; set; }
        }

        public class UpdateManualContractRequest
        {
            public int StartSeason { get; set; }
            public int EndSeason { get; set; }
            public decimal Salary { get; set; }
        }

        /// <summary>
        /// Lists every player currently flagged for manual management,
        /// with their contracts joined in. The admin page renders
        /// this as the "players under manual management" list.
        /// </summary>
        [HttpGet("capfreeze/manual-contracts/players")]
        public async Task<IActionResult> GetManualContractPlayers(
            CancellationToken ct)
        {
            var players = await _dbContext.Players
                .AsNoTracking()
                .Include(p => p.NhlTeam)
                .Where(p => p.SkipCapFreezeSync)
                .OrderBy(p => p.LastName)
                .ThenBy(p => p.FirstName)
                .ToListAsync(ct);

            if (players.Count == 0)
            {
                return Ok(Array.Empty<object>());
            }

            var playerIds = players
                .Select(p => p.Id)
                .ToList();

            var contracts = await _dbContext.PlayerContracts
                .AsNoTracking()
                .Where(c => playerIds.Contains(c.PlayerId))
                .OrderBy(c => c.StartSeason)
                .ToListAsync(ct);

            var contractsByPlayerId = contracts
                .GroupBy(c => c.PlayerId)
                .ToDictionary(g => g.Key, g => g.ToList());

            var result = players
                .Select(p =>
                {
                    var rows = contractsByPlayerId
                        .GetValueOrDefault(p.Id)
                        ?? new List<PlayerContract>();

                    return new
                    {
                        PlayerId = p.Id,
                        p.NhlPlayerId,
                        p.FirstName,
                        p.LastName,
                        TeamAbbreviation = p.NhlTeam != null
                            ? p.NhlTeam.Abbreviation
                            : null,
                        Contracts = rows
                            .Select(c => new
                            {
                                PlayerContractId = c.Id,
                                c.StartSeason,
                                c.EndSeason,
                                c.Salary,
                                c.ProtectedSalary,
                                c.ProtectionNote
                            })
                            .ToList()
                    };
                })
                .ToList();

            return Ok(result);
        }

        /// <summary>
        /// Toggles the SkipCapFreezeSync flag on a player.
        /// </summary>
        [HttpPost("capfreeze/manual-contracts/set-skip")]
        public async Task<IActionResult> SetSkipCapFreeze(
            [FromBody] SetPlayerSkipCapFreezeRequest request,
            CancellationToken ct)
        {
            if (request.NhlPlayerId <= 0)
            {
                return BadRequest(new
                {
                    message = "NhlPlayerId is required."
                });
            }

            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p =>
                    p.NhlPlayerId == request.NhlPlayerId, ct);

            if (player == null)
            {
                return BadRequest(new
                {
                    message =
                        $"No player with NhlPlayerId {request.NhlPlayerId}."
                });
            }

            player.SkipCapFreezeSync = request.Skip;

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new
            {
                player.NhlPlayerId,
                player.SkipCapFreezeSync
            });
        }

        /// <summary>
        /// Creates a new contract row for a manually-managed player.
        /// </summary>
        [HttpPost("capfreeze/manual-contracts/contract")]
        public async Task<IActionResult> CreateManualContract(
            [FromBody] CreateManualContractRequest request,
            CancellationToken ct)
        {
            if (request.NhlPlayerId <= 0)
            {
                return BadRequest(new
                {
                    message = "NhlPlayerId is required."
                });
            }

            if (request.StartSeason <= 0 ||
                request.EndSeason <= 0)
            {
                return BadRequest(new
                {
                    message = "StartSeason and EndSeason are required."
                });
            }

            if (request.EndSeason < request.StartSeason)
            {
                return BadRequest(new
                {
                    message =
                        "EndSeason must be >= StartSeason."
                });
            }

            if (request.Salary < 0)
            {
                return BadRequest(new
                {
                    message = "Salary must be >= 0."
                });
            }

            var player = await _dbContext.Players
                .FirstOrDefaultAsync(p =>
                    p.NhlPlayerId == request.NhlPlayerId, ct);

            if (player == null)
            {
                return BadRequest(new
                {
                    message =
                        $"No player with NhlPlayerId {request.NhlPlayerId}."
                });
            }

            var existing = await _dbContext.PlayerContracts
                .FirstOrDefaultAsync(c =>
                    c.PlayerId == player.Id &&
                    c.StartSeason == request.StartSeason, ct);

            if (existing != null)
            {
                return BadRequest(new
                {
                    message =
                        $"A contract starting {request.StartSeason} " +
                        "already exists for this player."
                });
            }

            var contract = new PlayerContract
            {
                PlayerId = player.Id,
                StartSeason = request.StartSeason,
                EndSeason = request.EndSeason,
                Salary = request.Salary
            };

            _dbContext.PlayerContracts.Add(contract);

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new
            {
                PlayerContractId = contract.Id,
                contract.StartSeason,
                contract.EndSeason,
                contract.Salary,
                contract.ProtectedSalary,
                contract.ProtectionNote
            });
        }

        /// <summary>
        /// Updates the start season, end season and salary of an
        /// existing contract row.
        /// </summary>
        [HttpPatch("capfreeze/manual-contracts/contract/{playerContractId:int}")]
        public async Task<IActionResult> UpdateManualContract(
            int playerContractId,
            [FromBody] UpdateManualContractRequest request,
            CancellationToken ct)
        {
            if (request.StartSeason <= 0 ||
                request.EndSeason <= 0)
            {
                return BadRequest(new
                {
                    message = "StartSeason and EndSeason are required."
                });
            }

            if (request.EndSeason < request.StartSeason)
            {
                return BadRequest(new
                {
                    message =
                        "EndSeason must be >= StartSeason."
                });
            }

            if (request.Salary < 0)
            {
                return BadRequest(new
                {
                    message = "Salary must be >= 0."
                });
            }

            var contract = await _dbContext.PlayerContracts
                .FirstOrDefaultAsync(c =>
                    c.Id == playerContractId, ct);

            if (contract == null)
            {
                return NotFound(new
                {
                    message =
                        $"No contract with Id {playerContractId}."
                });
            }

            var colliding = await _dbContext.PlayerContracts
                .AnyAsync(c =>
                    c.PlayerId == contract.PlayerId &&
                    c.StartSeason == request.StartSeason &&
                    c.Id != contract.Id, ct);

            if (colliding)
            {
                return BadRequest(new
                {
                    message =
                        "Another contract for this player already " +
                        $"starts {request.StartSeason}."
                });
            }

            contract.StartSeason = request.StartSeason;
            contract.EndSeason = request.EndSeason;
            contract.Salary = request.Salary;

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new
            {
                PlayerContractId = contract.Id,
                contract.StartSeason,
                contract.EndSeason,
                contract.Salary,
                contract.ProtectedSalary,
                contract.ProtectionNote
            });
        }

        /// <summary>
        /// Deletes a manual contract row.
        /// </summary>
        [HttpDelete("capfreeze/manual-contracts/contract/{playerContractId:int}")]
        public async Task<IActionResult> DeleteManualContract(
            int playerContractId,
            CancellationToken ct)
        {
            var contract = await _dbContext.PlayerContracts
                .FirstOrDefaultAsync(c =>
                    c.Id == playerContractId, ct);

            if (contract == null)
            {
                return NotFound(new
                {
                    message =
                        $"No contract with Id {playerContractId}."
                });
            }

            _dbContext.PlayerContracts.Remove(contract);

            await _dbContext.SaveChangesAsync(ct);

            return Ok(new { message = "Contract deleted." });
        }
    }
}