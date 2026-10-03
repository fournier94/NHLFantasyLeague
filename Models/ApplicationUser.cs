using Microsoft.AspNetCore.Identity;

namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// The logged-in user. Wraps ASP.NET Core Identity's IdentityUser
    /// with the one extra link this league needs: the fantasy team the
    /// user owns.
    ///
    /// A user with FantasyTeamId == null has registered but has not yet
    /// been assigned a team by the commissioner. He can log in, browse
    /// the standings and player pages, but cannot act on any team.
    ///
    /// A user owns exactly one fantasy team. A fantasy team is owned by
    /// exactly one user. Enforced by a unique filtered index on
    /// FantasyTeamId (see AppDbContext).
    /// </summary>
    public class ApplicationUser : IdentityUser<int>
    {
        /// <summary>
        /// The fantasy team this user controls, or null when the
        /// commissioner has not yet assigned one.
        /// </summary>
        public int? FantasyTeamId { get; set; }

        public FantasyTeam? FantasyTeam { get; set; }

        /// <summary>
        /// Friendly label used in the UI. Defaults to UserName when
        /// created; can be edited later.
        /// </summary>
        public string DisplayName { get; set; } = string.Empty;

        /// <summary>
        /// Visual style the user prefers for the PlayerPage. Persisted
        /// across sessions. Defaults to Neon for new accounts.
        /// </summary>
        public PlayerPageStyle PlayerPageStyle { get; set; } = PlayerPageStyle.Neon;

        /// <summary>UTC instant the account was created.</summary>
        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;
    }
}