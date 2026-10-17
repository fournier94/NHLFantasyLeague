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

        public int? FantasyTeamId { get; set; }
    }

    public class AuthUserDto
    {
        public int Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public int? FantasyTeamId { get; set; }
        public string? FantasyTeamName { get; set; }
        public bool IsCommissioner { get; set; }
        public string PlayerPageStyle { get; set; } = "Classic";

        public bool ShowContractsStats { get; set; }
        public bool ShowContractsRoster { get; set; }
    }

    public class SetPlayerPageStyleRequest
    {
        [Required]
        public string Style { get; set; } = string.Empty;
    }

    public class UpdatePreferencesRequest
    {
        public bool? ShowContractsStats { get; set; }
        public bool? ShowContractsRoster { get; set; }
    }

    public class AdminUserRowDto
    {
        public int Id { get; set; }
        public string UserName { get; set; } = string.Empty;
        public string DisplayName { get; set; } = string.Empty;
        public int? FantasyTeamId { get; set; }
        public string? FantasyTeamName { get; set; }
        public bool IsCommissioner { get; set; }
        public bool IsProtected { get; set; }
        public DateTime CreatedAt { get; set; }
        public DateTime? LastActiveAt { get; set; }
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

    public class UnclaimedTeamDto
    {
        public int Id { get; set; }
        public string Name { get; set; } = string.Empty;
    }
}