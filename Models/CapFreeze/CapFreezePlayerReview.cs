namespace NhlFantasyLeague.api.Models.CapFreeze
{
    public class CapFreezePlayerReview
    {
        public int Id { get; set; }

        public string CapFreezeName { get; set; } = string.Empty;

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public double FullNameSimilarity { get; set; }

        public double FirstNameSimilarity { get; set; }

        public double LastNameSimilarity { get; set; }

        public int NhlTeamId { get; set; }

        public bool IsReviewed { get; set; }

        public bool? IsApproved { get; set; }

        public DateTime CreatedAt { get; set; } = DateTime.UtcNow;

        public DateTime? ReviewedAt { get; set; }
    }
}