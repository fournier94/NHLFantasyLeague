using Microsoft.AspNetCore.Authorization;
using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Mvc;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Data;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.Auth;
using NhlFantasyLeague.api.Services.Auth;

namespace NhlFantasyLeague.api.Controllers
{
    /// <summary>
    /// Login, logout, registration, and "who am I".
    ///
    /// Login and register are the only anonymous endpoints. Everything
    /// else requires an authenticated user.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    public class AuthController : ControllerBase
    {
        private readonly AuthService _authService;
        private readonly SignInManager<ApplicationUser> _signInManager;
        private readonly UserManager<ApplicationUser> _userManager;
        private readonly AppDbContext _dbContext;

        public AuthController(
            AuthService authService,
            SignInManager<ApplicationUser> signInManager,
            UserManager<ApplicationUser> userManager,
            AppDbContext dbContext)
        {
            _authService = authService;
            _signInManager = signInManager;
            _userManager = userManager;
            _dbContext = dbContext;
        }

        // -----------------------------------------------------------------
        // Public
        // -----------------------------------------------------------------

        [AllowAnonymous]
        [HttpPost("login")]
        public async Task<IActionResult> Login([FromBody] LoginRequest request)
        {
            var user = await _userManager.FindByNameAsync(
                request.UserName.Trim());

            if (user == null)
            {
                return Unauthorized(new
                {
                    message = "Nom d'utilisateur ou mot de passe invalide."
                });
            }

            var result = await _signInManager.PasswordSignInAsync(
                user,
                request.Password,
                isPersistent: true,
                lockoutOnFailure: true);

            if (result.IsLockedOut)
            {
                return Unauthorized(new
                {
                    message = "Compte temporairement verrouillé. Réessayez " +
                              "dans quelques minutes."
                });
            }

            if (!result.Succeeded)
            {
                return Unauthorized(new
                {
                    message = "Nom d'utilisateur ou mot de passe invalide."
                });
            }

            return Ok(await BuildAuthUserAsync(user));
        }

        [AllowAnonymous]
        [HttpPost("register")]
        public async Task<IActionResult> Register([FromBody] RegisterRequest request)
        {
            var (user, error) = await _authService.RegisterAsync(
                request.UserName,
                request.Password,
                request.InviteCode,
                request.FantasyTeamId);

            if (user == null)
            {
                return BadRequest(new { message = error });
            }

            // Sign the new user in right away.
            await _signInManager.SignInAsync(
                user, isPersistent: true);

            return Ok(await BuildAuthUserAsync(user));
        }

        /// <summary>
        /// Returns the list of FantasyTeams that no user owns yet. Used
        /// by the registration form's team picker. Anonymous: a
        /// prospective user needs this before he has an account.
        /// </summary>
        [AllowAnonymous]
        [HttpGet("unclaimed-teams")]
        public async Task<IActionResult> GetUnclaimedTeams()
        {
            var claimedTeamIds = await _dbContext.Users
                .Where(u => u.FantasyTeamId != null)
                .Select(u => u.FantasyTeamId!.Value)
                .ToListAsync();

            var teams = await _dbContext.FantasyTeams
                .Where(t => !claimedTeamIds.Contains(t.Id))
                .OrderBy(t => t.Name)
                .Select(t => new UnclaimedTeamDto
                {
                    Id = t.Id,
                    Name = t.Name
                })
                .ToListAsync();

            return Ok(teams);
        }

        // -----------------------------------------------------------------
        // Authenticated
        // -----------------------------------------------------------------

        [HttpPost("logout")]
        public async Task<IActionResult> Logout()
        {
            await _signInManager.SignOutAsync();
            return Ok(new { message = "Déconnecté." });
        }

        [HttpGet("me")]
        public async Task<IActionResult> Me()
        {
            var user = await _userManager.GetUserAsync(User);

            if (user == null)
            {
                return Unauthorized();
            }

            return Ok(await BuildAuthUserAsync(user));
        }

        [HttpPost("change-password")]
        public async Task<IActionResult> ChangePassword(
            [FromBody] ChangePasswordRequest request)
        {
            var user = await _userManager.GetUserAsync(User);

            if (user == null)
            {
                return Unauthorized();
            }

            var result = await _userManager.ChangePasswordAsync(
                user, request.CurrentPassword, request.NewPassword);

            if (!result.Succeeded)
            {
                return BadRequest(new
                {
                    message = string.Join(" ",
                        result.Errors.Select(e => e.Description))
                });
            }

            await _signInManager.RefreshSignInAsync(user);

            return Ok(new { message = "Mot de passe mis à jour." });
        }

        // -----------------------------------------------------------------
        // Helpers
        // -----------------------------------------------------------------

        private async Task<AuthUserDto> BuildAuthUserAsync(ApplicationUser user)
        {
            string? teamName = null;

            if (user.FantasyTeamId.HasValue)
            {
                teamName = await _dbContext.FantasyTeams
                    .Where(t => t.Id == user.FantasyTeamId.Value)
                    .Select(t => t.Name)
                    .FirstOrDefaultAsync();
            }

            return new AuthUserDto
            {
                Id = user.Id,
                UserName = user.UserName ?? string.Empty,
                DisplayName = user.DisplayName,
                FantasyTeamId = user.FantasyTeamId,
                FantasyTeamName = teamName,
                IsCommissioner = await _authService.IsCommissionerAsync(user)
            };
        }
    }
}