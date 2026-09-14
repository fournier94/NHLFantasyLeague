using NhlFantasyLeague.api.Models;

public class Season
{
    public int Id { get; set; }

    public string Name { get; set; } = string.Empty;

    public DateOnly StartDate { get; set; }

    public DateOnly EndDate { get; set; }

    public decimal SalaryCap { get; set; }

    public decimal SalaryFloor { get; set; }

    public int NhlSeasonCode { get; set; }

    public int LeagueId { get; set; }

    public League League { get; set; } = null!;
}