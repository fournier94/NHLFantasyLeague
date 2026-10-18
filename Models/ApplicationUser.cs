using Microsoft.AspNetCore.Identity;

namespace NhlFantasyLeague.api.Models
{
    public class ApplicationUser : IdentityUser<int>
    {
        public int? FantasyTeamId { get; set; }

        public FantasyTeam? FantasyTeam { get; set; }

        public string DisplayName { get; set; } = string.Empty;

        public PlayerPageStyle PlayerPageStyle { get; set; } = PlayerPageStyle.Classic;

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime? LastActiveAt { get; set; }

        /// <summary>
        /// Controls whether the "Afficher les contrats" checkbox is
        /// ticked on the Statistiques page.
        /// </summary>
        public bool ShowContractsStats { get; set; } = false;

        /// <summary>
        /// Controls whether the "Contrats" checkbox is ticked on the
        /// MonEquipe page.
        /// </summary>
        public bool ShowContractsRoster { get; set; } = false;

        /// <summary>
        /// Persists the player filter selected on the Statistiques page
        /// ("rostered", "freeAgents", or "all"). Defaults to "rostered".
        /// </summary>
        public string StatistiquesPlayerFilter { get; set; } = "rostered";

        /// <summary>
        /// Persists the standings view selected on the Statistiques page
        /// ("division", "conference", or "league"). Defaults to "division".
        /// </summary>
        public string StatistiquesStandingsView { get; set; } = "division";
    }
}