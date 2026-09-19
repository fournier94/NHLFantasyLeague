using System.ComponentModel.DataAnnotations.Schema;

namespace NhlFantasyLeague.api.Models
{
    public class Player
    {
        public int Id { get; set; }

        public int NhlPlayerId { get; set; }

        public string FirstName { get; set; } = string.Empty;

        public string LastName { get; set; } = string.Empty;

        public string? CapFreezeName { get; set; }

        public string Position { get; set; } = string.Empty;

        public int? NhlTeamId { get; set; }

        public int? PreviousNhlTeamId { get; set; }

        [ForeignKey(nameof(NhlTeamId))]
        public NhlTeam? NhlTeam { get; set; }

        public DateOnly? BirthDate { get; set; }

        public string? BirthCity { get; set; }

        public string? BirthCountry { get; set; }

        public int? HeightInInches { get; set; }

        public int? WeightInPounds { get; set; }

        public string? ShootsCatches { get; set; }

        public string? HeadshotUrl { get; set; }

        public string? HeroImageUrl { get; set; }

        public PlayerStatus Status { get; set; } = PlayerStatus.Unsigned;

        public ICollection<PlayerContract> Contracts { get; set; }
            = new List<PlayerContract>();

        public DateTime? CapFreezeStatusLastUpdated { get; set; }

        public DateTime? CapFreezeContractLastUpdated { get; set; }
    }
}