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
        public DbSet<PlayerCareerStat> PlayerCareerStats { get; set; }
        public DbSet<PlayerContract> PlayerContracts { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            base.OnModelCreating(modelBuilder);

            modelBuilder.Entity<RosterEntry>()
                .Property(r => r.RosterStatus)
                .HasConversion<string>();

            modelBuilder.Entity<Player>()
                .HasOne(p => p.NhlTeam)
                .WithMany(t => t.Players)
                .HasForeignKey(p => p.NhlTeamId)
                .HasPrincipalKey(t => t.NhlTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<Season>()
                .HasIndex(x => x.NhlSeasonCode)
                .IsUnique();

            modelBuilder.Entity<Trade>()
                .HasOne(t => t.FromFantasyTeam)
                .WithMany()
                .HasForeignKey(t => t.FromFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<Trade>()
                .HasOne(t => t.ToFantasyTeam)
                .WithMany()
                .HasForeignKey(t => t.ToFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<DraftPick>()
                .HasOne(p => p.OriginalOwnerFantasyTeam)
                .WithMany()
                .HasForeignKey(p => p.OriginalOwnerFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<DraftPick>()
                .HasOne(p => p.CurrentOwnerFantasyTeam)
                .WithMany()
                .HasForeignKey(p => p.CurrentOwnerFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<TradeItem>()
                .HasOne(ti => ti.FromFantasyTeam)
                .WithMany()
                .HasForeignKey(ti => ti.FromFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<PlayerGameLog>()
                .HasOne(g => g.NhlTeam)
                .WithMany()
                .HasForeignKey(g => g.NhlTeamId)
                .HasPrincipalKey(t => t.NhlTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<PlayerGameLog>()
                .HasOne(g => g.OpponentNhlTeam)
                .WithMany()
                .HasForeignKey(g => g.OpponentNhlTeamId)
                .HasPrincipalKey(t => t.NhlTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<FantasyMatchup>()
                .HasOne(m => m.HomeFantasyTeam)
                .WithMany()
                .HasForeignKey(m => m.HomeFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<FantasyMatchup>()
                .HasOne(m => m.AwayFantasyTeam)
                .WithMany()
                .HasForeignKey(m => m.AwayFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<FantasyMatchup>()
                .HasOne(m => m.WinnerFantasyTeam)
                .WithMany()
                .HasForeignKey(m => m.WinnerFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<Player>()
                .HasIndex(p => p.NhlPlayerId)
                .IsUnique();

            modelBuilder.Entity<NhlTeam>()
                .HasIndex(t => t.NhlTeamId)
                .IsUnique();

            modelBuilder.Entity<FantasyTeam>()
                .HasIndex(x => new { x.LeagueId, x.Name })
                .IsUnique();

            modelBuilder.Entity<FantasyTeamSeason>()
                .HasIndex(x => new { x.FantasyTeamId, x.SeasonId })
                .IsUnique();

            modelBuilder.Entity<Season>()
                .HasIndex(x => new { x.LeagueId, x.Name })
                .IsUnique();

            modelBuilder.Entity<SeasonStanding>()
                .HasIndex(x => new { x.SeasonId, x.FantasyTeamId })
                .IsUnique();

            modelBuilder.Entity<KeeperSelection>()
                .HasIndex(x => new { x.SeasonId, x.FantasyTeamId, x.PlayerId })
                .IsUnique();

            modelBuilder.Entity<RosterEntry>()
                .HasIndex(x => new { x.SeasonId, x.FantasyTeamId, x.PlayerId })
                .IsUnique();

            modelBuilder.Entity<DraftPick>()
                .HasIndex(x => new { x.DraftId, x.Round, x.PickNumber })
                .IsUnique();

            modelBuilder.Entity<DraftSelection>()
                .HasIndex(x => x.DraftPickId)
                .IsUnique();

            modelBuilder.Entity<PlayerSeasonStat>()
                .HasIndex(x => new { x.SeasonId, x.PlayerId })
                .IsUnique();

            modelBuilder.Entity<WeeklyFantasyScore>()
                .HasIndex(x => new { x.SeasonId, x.PlayerId, x.WeekNumber })
                .IsUnique();

            modelBuilder.Entity<FantasyMatchup>()
                .HasIndex(x => new { x.SeasonId, x.WeekNumber, x.HomeFantasyTeamId })
                .IsUnique();

            modelBuilder.Entity<FantasyMatchup>()
                .HasIndex(x => new { x.SeasonId, x.WeekNumber, x.AwayFantasyTeamId })
                .IsUnique();

            modelBuilder.Entity<PlayerGameLog>()
                .HasIndex(x => new { x.PlayerId, x.NhlGameId })
                .IsUnique();

            modelBuilder.Entity<PlayerCareerStat>()
                .HasIndex(x => new
                {
                x.PlayerId,
                x.Season,
                x.GameTypeId,
                x.Sequence
                })
                .IsUnique();

            modelBuilder.Entity<PlayerCareerStat>()
                .HasOne(s => s.Player)
                .WithMany()
                .HasForeignKey(s => s.PlayerId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<PlayerContract>()
                .HasOne(c => c.Player)
                .WithMany(p => p.Contracts)
                .HasForeignKey(c => c.PlayerId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<PlayerContract>()
                .HasIndex(c => new
                {
                    c.PlayerId,
                    c.StartSeason
                })
                .IsUnique();

            modelBuilder.Entity<PlayerContract>()
                .Property(c => c.Salary)
                .HasPrecision(18, 2);

            modelBuilder.Entity<Player>()
                .Property(p => p.Status)
                .HasConversion<string>();
        }
    }
}