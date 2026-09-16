namespace NhlFantasyLeague.api.Services
{
    public class NhlMissingPlayerResult
    {
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;
        public string NhlTeamAbbreviation { get; set; } = string.Empty;
    }
}