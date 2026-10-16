namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// Une ligne du tableau "Meilleurs pointeurs" sur la page
    /// Statistiques. Contient tous les patineurs appartenant à une
    /// équipe fantasy de la ligue. Les gardiens ne sont pas inclus
    /// (ils ont un jeu de colonnes différent sur MonEquipePage).
    ///
    /// Les valeurs renvoyées sont strictement les mêmes que celles
    /// affichées sur une ligne de MonEquipePage.
    /// </summary>
    public class TopScorerRowDto
    {
        public int PlayerId { get; set; }
        public int NhlPlayerId { get; set; }
        public string FirstName { get; set; } = string.Empty;
        public string LastName { get; set; } = string.Empty;
        public string Position { get; set; } = string.Empty;
        public string NhlTeamAbbreviation { get; set; } = string.Empty;

        /// <summary>
        /// Id de l'équipe fantasy qui détient le joueur. Utilisé
        /// par le frontend pour construire un lien vers
        /// /mon-equipe?teamId={FantasyTeamId}, comme sur la
        /// ClassementPage.
        /// </summary>
        public int FantasyTeamId { get; set; }

        public string? FantasyTeamName { get; set; }

        public int GamesPlayed { get; set; }
        public int Goals { get; set; }
        public int Assists { get; set; }
        public int Points { get; set; }
        public int HatTricks { get; set; }

        public string? TimeOnIce { get; set; }

        public PlayerContractLineDto? CurrentContract { get; set; }

        public PlayerContractLineDto? SecondContract { get; set; }

        public int? FantasyPoints { get; set; }
    }
}