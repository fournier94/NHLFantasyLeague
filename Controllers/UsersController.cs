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
    /// Commissioner-only user management: list every account, promote
    /// or demote commissioners, reset passwords, and assign or unassign
    /// a FantasyTeam.
    ///
    /// The [Authorize(Roles = ...)] attribute gates the whole controller.
    /// </summary>
    [ApiController]
    [Route("api/[controller]")]
    [Authorize(Roles = AuthService.CommissionerRole)]
    public class UsersController : ControllerBase
    {
        private readonly AppDbContext _dbContext;
        private readonly UserManager<ApplicationUser> _userManager;

        public UsersController(
            AppDbContext dbContext,
            UserManager<ApplicationUser> userManager)
        {
            _dbContext = dbContext;
            _userManager = userManager;
        }

        /// <summary>Every user with his team and commissioner flag.</summary>
        [HttpGet]
        public async Task<IActionResult> GetUsers()
        {
            var users = await _dbContext.Users
                .Include(u => u.FantasyTeam)
                .OrderBy(u => u.UserName)
                .ToListAsync();

            var rows = new List<AdminUserRowDto>();

            foreach (var user in users)
            {
                rows.Add(new AdminUserRowDto
                {
                    Id = user.Id,
                    UserName = user.UserName ?? string.Empty,
                    DisplayName = user.DisplayName,
                    FantasyTeamId = user.FantasyTeamId,
                    FantasyTeamName = user.FantasyTeam?.Name,
                    IsCommissioner = await _userManager.IsInRoleAsync(
                        user, AuthService.CommissionerRole),
                    CreatedAt = user.CreatedAt
                });
            }

            return Ok(rows);
        }

        [HttpPost("{id:int}/promote")]
        public async Task<IActionResult> Promote(int id)
        {
            var user = await _userManager.FindByIdAsync(id.ToString());

            if (user == null)
            {
                return NotFound(new { message = "Utilisateur introuvable." });
            }

            if (!await _userManager.IsInRoleAsync(user, AuthService.CommissionerRole))
            {
                await _userManager.AddToRoleAsync(user, AuthService.CommissionerRole);
            }

            return Ok(new { message = $"{user.UserName} est maintenant commissaire." });
        }

        [HttpPost("{id:int}/demote")]
        public async Task<IActionResult> Demote(int id)
        {
            var user = await _userManager.FindByIdAsync(id.ToString());

            if (user == null)
            {
                return NotFound(new { message = "Utilisateur introuvable." });
            }

            if (await _userManager.IsInRoleAsync(user, AuthService.CommissionerRole))
            {
                await _userManager.RemoveFromRoleAsync(user, AuthService.CommissionerRole);
            }

            return Ok(new { message = $"{user.UserName} n'est plus commissaire." });
        }

        [HttpPost("{id:int}/reset-password")]
        public async Task<IActionResult> ResetPassword(
            int id,
            [FromBody] ResetPasswordRequest request)
        {
            var user = await _userManager.FindByIdAsync(id.ToString());

            if (user == null)
            {
                return NotFound(new { message = "Utilisateur introuvable." });
            }

            var token = await _userManager
                .GeneratePasswordResetTokenAsync(user);

            var result = await _userManager
                .ResetPasswordAsync(user, token, request.NewPassword);

            if (!result.Succeeded)
            {
                return BadRequest(new
                {
                    message = string.Join(" ",
                        result.Errors.Select(e => e.Description))
                });
            }

            return Ok(new
            {
                message = $"Mot de passe de {user.UserName} réinitialisé."
            });
        }

        /// <summary>
        /// Assigns a FantasyTeam to a user. Strict: refuses if the team
        /// is already owned by someone else. The commissioner must
        /// unassign the current owner first.
        /// </summary>
        [HttpPost("{id:int}/assign-team")]
        public async Task<IActionResult> AssignTeam(
            int id,
            [FromBody] AssignTeamRequest request)
        {
            var user = await _userManager.FindByIdAsync(id.ToString());

            if (user == null)
            {
                return NotFound(new { message = "Utilisateur introuvable." });
            }

            var team = await _dbContext.FantasyTeams
                .FirstOrDefaultAsync(t => t.Id == request.FantasyTeamId);

            if (team == null)
            {
                return BadRequest(new { message = "Équipe inconnue." });
            }

            var currentlyOwnedBy = await _dbContext.Users
                .FirstOrDefaultAsync(u =>
                    u.FantasyTeamId == request.FantasyTeamId &&
                    u.Id != user.Id);

            if (currentlyOwnedBy != null)
            {
                return BadRequest(new
                {
                    message =
                        $"Cette équipe est présentement assignée à " +
                        $"'{currentlyOwnedBy.UserName}'. Désassignez-le " +
                        "d'abord."
                });
            }

            user.FantasyTeamId = request.FantasyTeamId;
            await _dbContext.SaveChangesAsync();

            return Ok(new
            {
                message =
                    $"'{team.Name}' est maintenant assignée à {user.UserName}."
            });
        }

        [HttpPost("{id:int}/unassign-team")]
        public async Task<IActionResult> UnassignTeam(int id)
        {
            var user = await _userManager.FindByIdAsync(id.ToString());

            if (user == null)
            {
                return NotFound(new { message = "Utilisateur introuvable." });
            }

            user.FantasyTeamId = null;
            await _dbContext.SaveChangesAsync();

            return Ok(new
            {
                message = $"{user.UserName} n'a plus d'équipe."
            });
        }
    }
}