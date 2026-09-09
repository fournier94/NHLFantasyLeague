using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;

namespace NhlFantasyLeague.api.Data
{
    public class AppDbContext : DbContext
    {
        public AppDbContext(DbContextOptions<AppDbContext> options)
            : base(options)
        {
        }

        public DbSet<Player> Players { get; set; }

        public DbSet<NhlTeam> NhlTeams { get; set; }

        public DbSet<FantasyTeam> FantasyTeams { get; set; }

        public DbSet<Season> Seasons { get; set; }

        public DbSet<RosterEntry> RosterEntries { get; set; }
        public DbSet<SeasonStanding> SeasonStandings { get; set; }
        public DbSet<DraftPick> DraftPicks { get; set; }
        public DbSet<Trade> Trades { get; set; }
        public DbSet<TradeItem> TradeItems { get; set; }
        public DbSet<KeeperSelection> KeeperSelections { get; set; }
        public DbSet<Draft> Drafts { get; set; }
        public DbSet<DraftSelection> DraftSelections { get; set; }
        public DbSet<League> Leagues { get; set; }
        public DbSet<FantasyTeamSeason> FantasyTeamSeasons { get; set; }
        public DbSet<PlayerSeasonStat> PlayerSeasonStats { get; set; }
        public DbSet<PlayerGameLog> PlayerGameLogs { get; set; }
        public DbSet<WeeklyFantasyScore> WeeklyFantasyScores { get; set; }
        public DbSet<FantasyMatchup> FantasyMatchups { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<RosterEntry>()
                .Property(r => r.RosterStatus)
                .HasConversion<string>();
        }
    }
}