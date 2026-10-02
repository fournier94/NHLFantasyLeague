using Microsoft.AspNetCore.Identity;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Auth;

namespace NhlFantasyLeague.api.Services.Auth
{
    /// <summary>
    /// Registration, login, user/team assignment, and role management.
    ///
    /// The invite code is validated here (never trust the frontend).
    /// The role name for commissioner is the single constant below.
    /// </summary>
    public class AuthService
    {
        public const string CommissionerRole = "Commissioner";

        private readonly AppDbContext _dbContext;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly IConfiguration _configuration;

        public AuthService(
            AppDbContext dbContext,
            UserManager<ApplicationUser> userManager,
            IConfiguration configuration)
        {
            _dbContext = dbContext;
            _userManager = userManager;
            _configuration = configuration;
        }

        /// <summary>
        /// The invite code from appsettings.json. Never logged, never
        /// returned. Compared with a case-insensitive match so the
        /// commissioner's typed value is forgiving.
        /// </summary>
        public string InviteCode =>
            _configuration["Auth:InviteCode"] ?? string.Empty;

        // -----------------------------------------------------------------
        // Registration
        // -----------------------------------------------------------------

        /// <summary>
        /// Registers a new user. Requires a valid invite code. Optionally
        /// attaches the user to a FantasyTeam at creation.
        ///
        /// Returns the created user, or an error string.
        /// </summary>
        public async Task<(ApplicationUser? User, string? Error)> RegisterAsync(
            string userName,
            string password,
            string inviteCode,
            int? fantasyTeamId,
            CancellationToken ct = default)
        {
            if (string.IsNullOrWhiteSpace(userName))
            {
                return (null, "Le nom d'utilisateur est requis.");
            }

            if (string.IsNullOrWhiteSpace(password))
            {
                return (null, "Le mot de passe est requis.");
            }

            if (!string.Equals(
                    inviteCode?.Trim(),
                    InviteCode.Trim(),
                    StringComparison.OrdinalIgnoreCase))
            {
                return (null, "Code d'invitation invalide.");
            }

            var trimmedUserName = userName.Trim();

            var existing = await _userManager.FindByNameAsync(trimmedUserName);
            if (existing != null)
            {
                return (null, "Ce nom d'utilisateur est déjà utilisé.");
            }

            if (fantasyTeamId.HasValue)
            {
                var teamClaimed = await _dbContext.Users
                    .AnyAsync(u => u.FantasyTeamId == fantasyTeamId.Value, ct);

                if (teamClaimed)
                {
                    return (null,
                        "Cette équipe est déjà réclamée par un autre compte.");
                }

                var teamExists = await _dbContext.FantasyTeams
                    .AnyAsync(t => t.Id == fantasyTeamId.Value, ct);

                if (!teamExists)
                {
                    return (null, "Équipe inconnue.");
                }
            }

            var user = new ApplicationUser
            {
                UserName = trimmedUserName,
                DisplayName = trimmedUserName,
                FantasyTeamId = fantasyTeamId,
                CreatedAt = DateTime.UtcNow
            };

            var result = await _userManager.CreateAsync(user, password);

            if (!result.Succeeded)
            {
                var message = string.Join(" ", result.Errors.Select(e => e.Description));
                return (null, message);
            }

            return (user, null);
        }

        // -----------------------------------------------------------------
        // Bootstrap
        // -----------------------------------------------------------------

        /// <summary>
        /// Ensures every username listed in Auth:CommissionerUsernames
        /// holds the Commissioner role. Runs on startup. Idempotent.
        /// </summary>
        public async Task EnsureCommissionersAsync(CancellationToken ct = default)
        {
            // Ensure the role exists at all.
            var roleExists = await _dbContext.Roles
                .AnyAsync(r => r.Name == CommissionerRole, ct);

            if (!roleExists)
            {
                _dbContext.Roles.Add(new IdentityRole<int>
                {
                    Name = CommissionerRole,
                    NormalizedName = CommissionerRole.ToUpperInvariant()
                });

                await _dbContext.SaveChangesAsync(ct);
            }

            var usernames = _configuration
                .GetSection("Auth:CommissionerUsernames")
                .Get<string[]>() ?? Array.Empty<string>();

            foreach (var raw in usernames)
            {
                if (string.IsNullOrWhiteSpace(raw))
                {
                    continue;
                }

                var user = await _userManager.FindByNameAsync(raw.Trim());

                if (user == null)
                {
                    // The user hasn't registered yet. That's fine: he'll
                    // get the role on the next restart after registering.
                    continue;
                }

                if (!await _userManager.IsInRoleAsync(user, CommissionerRole))
                {
                    await _userManager.AddToRoleAsync(user, CommissionerRole);
                }
            }
        }

        // -----------------------------------------------------------------
        // Helpers used by the controllers
        // -----------------------------------------------------------------

        /// <summary>Returns the current user's ApplicationUser row, or null.</summary>
        public async Task<ApplicationUser?> GetByIdAsync(int userId, CancellationToken ct = default)
        {
            return await _dbContext.Users
                .Include(u => u.FantasyTeam)
                .FirstOrDefaultAsync(u => u.Id == userId, ct);
        }

        public async Task<bool> IsCommissionerAsync(ApplicationUser user)
        {
            return await _userManager.IsInRoleAsync(user, CommissionerRole);
        }
    }
}