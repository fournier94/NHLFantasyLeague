using System.ComponentModel.DataAnnotations.Schema;

namespace NhlFantasyLeague.api.Models
{
    public class Player
    {
        public int Id { get; set; }

        public int NhlPlayerId { get; set; }

        public string FirstName { get; set; } = string.Empty;

        public string LastName { get; set; } = string.Empty;

        public string Position { get; set; } = string.Empty;

        public int? NhlTeamId { get; set; }

        [ForeignKey(nameof(NhlTeamId))]
        public NhlTeam? NhlTeam { get; set; }

        public DateOnly? BirthDate { get; set; }

        public string? HeadshotUrl { get; set; }

        public bool IsRfa { get; set; }
    }
}