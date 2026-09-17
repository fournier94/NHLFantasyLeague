namespace NhlFantasyLeague.api.Models
{
    public class PlayerContract
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int StartSeason { get; set; }

        public int EndSeason { get; set; }

        public decimal Salary { get; set; }
    }
}