namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// The career-table payload for a player, split out of
    /// PlayerDetailDto so the initial page load is small. Contains
    /// every list the "Saison régulière", "Séries", "Tournois" and
    /// "Youth / Minor" sections render, plus the NHL totals line.
    /// </summary>
    public class PlayerCareerDto
    {
        public List<CareerRowDto> RegularSeason { get; set; } = new();
        public List<CareerRowDto> Playoffs { get; set; } = new();
        public CareerTotalsDto NhlTotals { get; set; } = new();
        public List<CareerRowDto> Tournaments { get; set; } = new();
        public List<CareerRowDto> YouthMinor { get; set; } = new();
    }
}