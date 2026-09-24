namespace NhlFantasyLeague.api.Models.Dtos
{
    /// <summary>
    /// One contract shown on a player card: salary and years left for the
    /// season the card is displaying.
    /// </summary>
    public class PlayerContractLineDto
    {
        /// <summary>Salary in dollars.</summary>
        public decimal Salary { get; set; }

        /// <summary>Number of seasons left on the contract, from the displayed season.</summary>
        public int YearsRemaining { get; set; }

        /// <summary>First season code of the contract (e.g. 20252026).</summary>
        public int StartSeason { get; set; }

        /// <summary>Last season code of the contract (e.g. 20282029).</summary>
        public int EndSeason { get; set; }
    }
}