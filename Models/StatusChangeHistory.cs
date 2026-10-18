using System.ComponentModel.DataAnnotations.Schema;

namespace NhlFantasyLeague.api.Models
{
    /// <summary>
    /// Permanent audit record of one commissioner-executed status
    /// change (a batch swap of statuses on a single fantasy team).
    ///
    /// The content is frozen in <see cref="SnapshotJson"/> at the
    /// instant the admin confirmed it. The snapshot stores each
    /// pair of players, their previous statuses, their new statuses,
    /// positions, and NHL team as they were at change time.
    ///
    /// Never deleted manually. Use RevertStatusChangeAsync to erase
    /// the entire record and undo the changes, which removes the
    /// audit row and the linked history rows in one transaction.
    /// </summary>
    public class StatusChangeHistory
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }
        public Season Season { get; set; } = null!;

        public int FantasyTeamId { get; set; }
        public FantasyTeam FantasyTeam { get; set; } = null!;

        /// <summary>"Active", "Bench" or "Prospect". String for stability.</summary>
        public string StatusAName { get; set; } = string.Empty;

        /// <summary>"Active", "Bench" or "Prospect". String for stability.</summary>
        public string StatusBName { get; set; } = string.Empty;

        /// <summary>UTC instant (day precision) the swap takes effect.</summary>
        public DateTime EffectiveAt { get; set; }

        /// <summary>UTC instant the commissioner clicked the final Confirmer.</summary>
        public DateTime ConfirmedAt { get; set; }

        public string? Note { get; set; }

        [Column(TypeName = "jsonb")]
        public string SnapshotJson { get; set; } = string.Empty;

        public ICollection<StatusChangeDateChange> DateChanges { get; set; }
            = new List<StatusChangeDateChange>();
    }
}