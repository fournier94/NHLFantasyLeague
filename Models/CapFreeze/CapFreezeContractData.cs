namespace NhlFantasyLeague.api.Models.CapFreeze
{
    public class CapFreezeContractData
    {
        public int StartSeason { get; set; }

        public int TermYears { get; set; }

        public decimal FirstSalary { get; set; }

        public decimal? SecondSalary { get; set; }
    }
}