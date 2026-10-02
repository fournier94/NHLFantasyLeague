using System.ComponentModel.DataAnnotations;

namespace NhlFantasyLeague.api.Models.Auth
{
    public class LoginRequest
    {
        [Required]
        public string UserName { get; set; } = string.Empty;

        [Required]
        public string Password { get; set; } = string.Empty;
    }

    public class RegisterRequest
    {
        [Required]
        public string UserName { get; set; } = string.Empty;

        [Required]
        public string Password { get; set; } = string.Empty;

        [Required]
        public string InviteCode { get; set; } = string.Empty;

        /// <summary>Optional: the FantasyTeam the user wants to own.</summary>
        public int? FantasyTeamId { get; set; }
    }

    /// <summary>
    /// The "who am I" payload. Returned by /api/Auth/me and by login /
    /// register. Frontend uses this to build its auth context.
    /// </summary>
    public class AuthUserDto
    {
        public int Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public int? FantasyTeamId { get; set; }
        public string? FantasyTeamName { get; set; }
        public bool IsCommissioner { get; set; }
    }

    /// <summary>Row of the commissioner's Users page.</summary>
    public class AdminUserRowDto
    {
        public int Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public int? FantasyTeamId { get; set; }
        public string? FantasyTeamName { get; set; }
        public bool IsCommissioner { get; set; }
        public DateTime CreatedAt { get; set; }
    }

    public class AssignTeamRequest
    {
        [Required]
        public int FantasyTeamId { get; set; }
    }

    public class ResetPasswordRequest
    {
        [Required]
        public string NewPassword { get; set; } = string.Empty;
    }

    public class ChangePasswordRequest
    {
        [Required]
        public string CurrentPassword { get; set; } = string.Empty;

        [Required]
        public string NewPassword { get; set; } = string.Empty;
    }

    /// <summary>One unclaimed team, used by the registration dropdown.</summary>
    public class UnclaimedTeamDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
    }
}