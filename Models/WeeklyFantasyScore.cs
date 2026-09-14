namespace NhlFantasyLeague.api.Models
{
    public class WeeklyFantasyScore
    {
        public int Id { get; set; }

        public int PlayerId { get; set; }

        public Player Player { get; set; } = null!;

        public int SeasonId { get; set; }

        public Season Season { get; set; } = null!;

        public int WeekNumber { get; set; }

        public DateOnly WeekStart { get; set; }

        public DateOnly WeekEnd { get; set; }

        public int NhlPoints { get; set; }

        public int HatTrickBonus { get; set; }

        public int GoalieWinPoints { get; set; }

        public int GoalieOvertimeLossPoints { get; set; }

        public int ShutoutBonus { get; set; }

        public int TotalFantasyPoints { get; set; }
    }
}