namespace NhlFantasyLeague.api.Models
{
    public class Draft
    {
        public int Id { get; set; }

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public DateTime DraftDate { get; set; }

        public int NumberOfRounds { get; set; }
    }
}