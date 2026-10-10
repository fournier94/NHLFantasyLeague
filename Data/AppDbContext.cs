using Microsoft.AspNetCore.Identity;
using Microsoft.AspNetCore.Identity.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore;
using NhlFantasyLeague.api.Models;
using NhlFantasyLeague.api.Models.CapFreeze;

namespace NhlFantasyLeague.api.Data
{
    public class AppDbContext
        : IdentityDbContext<ApplicationUser, IdentityRole<int>, int>
    {
        public AppDbContext(DbContextOptions<AppDbContext> options)
            : base(options)
        {
        }

        public DbSet<Player> Players { get; set; }
        public DbSet<NhlTeam> NhlTeams { get; set; }

        /// <summary>
        /// One row per (NHL team, season, game type). Stores every
        /// season-level team aggregate the NHL API exposes.
        /// </summary>
        public DbSet<NhlTeamSeasonStat> NhlTeamSeasonStats { get; set; }

        /// <summary>
        /// One row per NHL game: per-team shots and score. Populated
        /// by the live refresh and post-game write; read by the Game
        /// Day page for the shots line on past dates.
        /// </summary>
        public DbSet<NhlGameStat> NhlGameStats { get; set; }

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
        public DbSet<CapFreezePlayerReview> CapFreezePlayerReviews { get; set; }
        public DbSet<PlayerInjuryHistory> PlayerInjuryHistories { get; set; }
        public DbSet<RosterStatusHistory> RosterStatusHistories { get; set; }

        /// <summary>
        /// One row per external data source our sync jobs depend on.
        /// See ExternalSourceHealth for the shape.
        /// </summary>
        public DbSet<ExternalSourceHealth> ExternalSourceHealths { get; set; }

        /// <summary>
        /// Data Protection key ring. Persisted to the database so that
        /// auth cookies survive API restarts and new deployments. Without
        /// this, every redeploy generates a new key ring and every
        /// existing cookie becomes undecryptable, which logs everyone out.
        /// See Program.cs where PersistKeysToDbContext is wired up.
        /// </summary>
        public DbSet<DataProtectionKey> DataProtectionKeys { get; set; }

        /// <summary>
        /// Auto-recorded errors and warnings from HTTP calls and
        /// scheduled jobs. Surfaced on the admin page.
        /// </summary>
        public DbSet<SystemEventLog> SystemEventLogs { get; set; }

        /// <summary>
        /// Marketplace offers, one row per published offer.
        /// </summary>
        public DbSet<TradeOffer> TradeOffers { get; set; }

        /// <summary>
        /// Slots of a marketplace offer. One row per pair
        /// (offered player, demanded position + filters).
        /// </summary>
        public DbSet<TradeOfferSlot> TradeOfferSlots { get; set; }

        /// <summary>
        /// Per-user memory of which marketplace offers a user has
        /// already seen. One row per (UserId, TradeOfferId); only its
        /// existence matters (it drives the "Nouvelle offre" badge).
        /// </summary>
        public DbSet<TradeOfferView> TradeOfferViews { get; set; }

        /// <summary>
        /// Marketplace responses. One row per (TradeOffer, RespondingTeam)
        /// while the offer is active. What the offer creator sees in
        /// his "Offres reçues" section.
        /// </summary>
        public DbSet<TradeOfferResponse> TradeOfferResponses { get; set; }

        /// <summary>
        /// One row per pick inside a TradeOfferResponse: the player
        /// the responding team is offering for the corresponding slot
        /// of the original offer.
        /// </summary>
        public DbSet<TradeOfferResponseSlot> TradeOfferResponseSlots { get; set; }

        protected override void OnModelCreating(ModelBuilder modelBuilder)
        {
            // Identity first, so all its table config is registered.
            base.OnModelCreating(modelBuilder);

            // -----------------------------------------------------------------
            // ApplicationUser <-> FantasyTeam
            // -----------------------------------------------------------------

            modelBuilder.Entity<ApplicationUser>()
                .HasOne(u => u.FantasyTeam)
                .WithMany()
                .HasForeignKey(u => u.FantasyTeamId)
                .OnDelete(DeleteBehavior.SetNull);

            // A FantasyTeam can be owned by at most one user. Filtered
            // unique index: rows with FantasyTeamId IS NULL are ignored,
            // so any number of users can be unassigned at the same time.
            modelBuilder.Entity<ApplicationUser>()
         .HasIndex(u => u.FantasyTeamId)
         .HasFilter("\"FantasyTeamId\" IS NOT NULL")
         .IsUnique();

            // Store PlayerPageStyle as its string name so the DB stays
            // readable and enum reordering never breaks existing rows.
            modelBuilder.Entity<ApplicationUser>()
      .Property(u => u.PlayerPageStyle)
      .HasConversion<string>();

            // -----------------------------------------------------------------
            // Existing model configuration, unchanged below.
            // -----------------------------------------------------------------

            modelBuilder.Entity<RosterEntry>()
                .Property(r => r.RosterStatus)
                .HasConversion<string>();

            modelBuilder.Entity<RosterStatusHistory>()
                .Property(h => h.RosterStatus)
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

            // One row per (team, season, game type). The daily sync
            // upserts against this key, so it must be unique or the
            // upsert would silently create duplicates.
            modelBuilder.Entity<NhlTeamSeasonStat>()
                .HasIndex(s => new
                {
                    s.NhlTeamId,
                    s.NhlSeasonCode,
                    s.GameTypeId
                })
                .IsUnique();

            modelBuilder.Entity<NhlTeamSeasonStat>()
        .HasOne(s => s.NhlTeam)
        .WithMany()
        .HasForeignKey(s => s.NhlTeamId)
        .HasPrincipalKey(t => t.NhlTeamId)
        .OnDelete(DeleteBehavior.Cascade);

            // -----------------------------------------------------------------
            // NhlGameStat
            // -----------------------------------------------------------------

            // One row per NHL game. The live refresh and post-game
            // write upsert against this key.
            modelBuilder.Entity<NhlGameStat>()
                .HasIndex(s => s.NhlGameId)
                .IsUnique();

            // Reading past-game shots: one query per date.
            modelBuilder.Entity<NhlGameStat>()
                .HasIndex(s => s.GameDate);

            // Percentage fields. numeric(6,3) is enough for values
            // like 0.737 (save pctg style) or 21.500 (PP% style), so
            // the same precision works whether the API sends a
            // fraction or a percentage.
            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.PointPctg)
                .HasPrecision(6, 3);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.PowerPlayPct)
                .HasPrecision(6, 3);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.PowerPlayNetPct)
                .HasPrecision(6, 3);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.PenaltyKillPct)
                .HasPrecision(6, 3);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.PenaltyKillNetPct)
                .HasPrecision(6, 3);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.FaceoffWinPct)
                .HasPrecision(6, 3);

            // Per-game averages. numeric(6,2) fits values like
            // "31.42" (shots per game) or "3.21" (goals per game).
            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.ShotsForPerGame)
                .HasPrecision(6, 2);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.ShotsAgainstPerGame)
                .HasPrecision(6, 2);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.GoalsForPerGame)
                .HasPrecision(6, 2);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.GoalsAgainstPerGame)
                .HasPrecision(6, 2);

            modelBuilder.Entity<NhlTeamSeasonStat>()
                .Property(s => s.PenaltyMinutesPerGame)
                .HasPrecision(6, 2);

            modelBuilder.Entity<FantasyTeam>()
                .HasIndex(x => new { x.LeagueId, x.Name })
                .IsUnique();

            modelBuilder.Entity<FantasyTeamSeason>()
      .HasIndex(x => new { x.FantasyTeamId, x.SeasonId })
      .IsUnique();

            // Optimistic concurrency on FantasyTeamSeason.
            //
            // PostgreSQL's xmin system column is automatically maintained
            // by the database and incremented on every UPDATE. Mapping it
            // as a concurrency token means two concurrent writers of the
            // same FantasyTeamSeason row cannot silently overwrite each
            // other: the second one to save throws
            // DbUpdateConcurrencyException, and the two write paths
            // (live persist, season recompute) each handle it.
            //
            // Why this matters here: the live refresh (under _liveLock)
            // and the season recompute (under _heavyLock) run on
            // separate locks and can execute concurrently. Both add
            // fantasy points to the same FantasyTeamSeason rows. Without
            // the token, the second SaveChangesAsync silently overwrites
            // the first one's deltas. The race fires most often when a
            // roster change triggers the on-demand recompute while a
            // live game is being persisted.
            //
            // Retry logic lives in:
            //   - NhlGameService.PersistSnapshotsAsync
            //     (throws; the caller's existing tick retry picks it up)
            //   - NhlGameLogService.RecomputeTeamSeasonTotalsAsync
            //     (bounded retry, ChangeTracker.Clear between attempts)
            modelBuilder.Entity<FantasyTeamSeason>()
                .UseXminAsConcurrencyToken();

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

            // Performance: the daily-totals and season-recompute queries filter
            // by (SeasonId, GameDate). Without this index, each call scans every
            // game log in the table.
            modelBuilder.Entity<PlayerGameLog>()
                .HasIndex(x => new { x.SeasonId, x.GameDate });

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

            modelBuilder.Entity<PlayerInjuryHistory>()
                .HasOne(h => h.Player)
                .WithMany()
                .HasForeignKey(h => h.PlayerId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<PlayerInjuryHistory>()
                .HasIndex(h => new
                {
                    h.PlayerId,
                    h.InjuryStatus,
                    h.TeamAbbreviation
                })
                .HasFilter("\"ResolvedAt\" IS NULL")
                .IsUnique();

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

            // Per-contract protection columns.
            modelBuilder.Entity<PlayerContract>()
                .Property(c => c.ProtectedSalary)
                .HasPrecision(18, 2);

            modelBuilder.Entity<PlayerContract>()
                .Property(c => c.ProtectionNote)
                .HasMaxLength(500);

            modelBuilder.Entity<Player>()
                .Property(p => p.Status)
                .HasConversion<string>();

            // Store RosterLocation as its string name so the DB is
            // readable and enum reordering never breaks existing rows.
            modelBuilder.Entity<Player>()
                .Property(p => p.RosterLocation)
                .HasConversion<string>();

            modelBuilder.Entity<CapFreezePlayerReview>()
                .HasOne(r => r.Player)
                .WithMany()
                .HasForeignKey(r => r.PlayerId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<CapFreezePlayerReview>()
                .HasIndex(r => new
                {
                    r.CapFreezeName,
                    r.PlayerId
                });

            modelBuilder.Entity<CapFreezePlayerReview>()
                .Property(r => r.FullNameSimilarity)
                .HasPrecision(5, 4);

            modelBuilder.Entity<CapFreezePlayerReview>()
                .Property(r => r.FirstNameSimilarity)
                .HasPrecision(5, 4);

            modelBuilder.Entity<CapFreezePlayerReview>()
                .Property(r => r.LastNameSimilarity)
                .HasPrecision(5, 4);

            modelBuilder.Entity<RosterStatusHistory>()
                .HasOne(h => h.Player)
                .WithMany()
                .HasForeignKey(h => h.PlayerId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<RosterStatusHistory>()
                .HasOne(h => h.FantasyTeam)
                .WithMany()
                .HasForeignKey(h => h.FantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<RosterStatusHistory>()
                .HasOne(h => h.Season)
                .WithMany()
                .HasForeignKey(h => h.SeasonId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<RosterStatusHistory>()
      .HasIndex(h => new
      {
          h.PlayerId,
          h.SeasonId,
          h.EffectiveAt
      });

            // Performance: standings and daily totals load every history row for
            // a season. Without this index, PostgreSQL scans the whole table.
            modelBuilder.Entity<RosterStatusHistory>()
                .HasIndex(h => new
                {
                    h.SeasonId,
                    h.EffectiveAt
                });

            // ExternalSourceHealth: one row per source, keyed by name.
            modelBuilder.Entity<ExternalSourceHealth>()
                .HasIndex(h => h.SourceName)
                .IsUnique();

            // -----------------------------------------------------------------
            // DataProtectionKey
            // -----------------------------------------------------------------
            modelBuilder.Entity<DataProtectionKey>(entity =>
            {
                entity.ToTable("DataProtectionKeys");
                entity.HasKey(e => e.Id);
                entity.Property(e => e.FriendlyName).HasMaxLength(256);
                entity.Property(e => e.Xml).IsRequired();
            });

            // SystemEventLogs: lookups are (a) by DedupeKey + recency
            // for the dedup check, and (b) by LastSeenUtc desc for the
            // admin page and the cleanup job.
            modelBuilder.Entity<SystemEventLog>()
                .HasIndex(e => new { e.DedupeKey, e.LastSeenUtc });

            modelBuilder.Entity<SystemEventLog>()
                .HasIndex(e => e.LastSeenUtc);

            modelBuilder.Entity<SystemEventLog>()
                .Property(e => e.Source)
                .HasMaxLength(100);

            modelBuilder.Entity<SystemEventLog>()
                .Property(e => e.Category)
                .HasMaxLength(50);

            modelBuilder.Entity<SystemEventLog>()
                .Property(e => e.Severity)
                .HasMaxLength(20);

            modelBuilder.Entity<SystemEventLog>()
                .Property(e => e.Message)
                .HasMaxLength(500);

            modelBuilder.Entity<SystemEventLog>()
                .Property(e => e.Details)
                .HasMaxLength(2000);

            modelBuilder.Entity<SystemEventLog>()
                .Property(e => e.DedupeKey)
                .HasMaxLength(64);

            // -----------------------------------------------------------------
            // TradeOffer / TradeOfferSlot (Marketplace)
            // -----------------------------------------------------------------

            modelBuilder.Entity<TradeOffer>()
                .HasOne(o => o.CreatedByFantasyTeam)
                .WithMany()
                .HasForeignKey(o => o.CreatedByFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<TradeOffer>()
                .HasOne(o => o.Season)
                .WithMany()
                .HasForeignKey(o => o.SeasonId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<TradeOffer>()
                .Property(o => o.Note)
                .HasMaxLength(1000);

            modelBuilder.Entity<TradeOffer>()
                .Property(o => o.Status)
                .HasConversion<string>();

            modelBuilder.Entity<TradeOffer>()
                .HasIndex(o => new { o.Status, o.CreatedAt });

            modelBuilder.Entity<TradeOfferSlot>()
                .HasOne(s => s.TradeOffer)
                .WithMany(o => o.Slots)
                .HasForeignKey(s => s.TradeOfferId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<TradeOfferSlot>()
                .HasOne(s => s.OfferingPlayer)
                .WithMany()
                .HasForeignKey(s => s.OfferingPlayerId)
                .OnDelete(DeleteBehavior.Restrict);

            modelBuilder.Entity<TradeOfferSlot>()
                .Property(s => s.PositionGroup)
                .HasMaxLength(1);

            modelBuilder.Entity<TradeOfferSlot>()
                .Property(s => s.DemandMaxSalary)
                .HasPrecision(18, 2);

            modelBuilder.Entity<TradeOfferSlot>()
                .HasIndex(s => new { s.TradeOfferId, s.SlotIndex })
                .IsUnique();

            // -----------------------------------------------------------------
            // TradeOfferView (per-user "already seen" marker)
            // -----------------------------------------------------------------

            // Cascade on both sides:
            //   - if the user is deleted, drop his view rows;
            //   - if the offer is deleted (shouldn't happen, but just
            //     in case), drop its view rows too.
            modelBuilder.Entity<TradeOfferView>()
                .HasOne(v => v.User)
                .WithMany()
                .HasForeignKey(v => v.UserId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<TradeOfferView>()
                .HasOne(v => v.TradeOffer)
                .WithMany()
                .HasForeignKey(v => v.TradeOfferId)
                .OnDelete(DeleteBehavior.Cascade);

            // One row per (user, offer). Guarantees the "seen" marker
            // is idempotent even if a user double-taps the browse tab.
            modelBuilder.Entity<TradeOfferView>()
                .HasIndex(v => new { v.UserId, v.TradeOfferId })
                .IsUnique();

            // -----------------------------------------------------------------
            // TradeOfferResponse / TradeOfferResponseSlot
            // -----------------------------------------------------------------

            // Cascade from the offer: if an offer is ever hard-deleted,
            // its responses go with it.
            modelBuilder.Entity<TradeOfferResponse>()
                .HasOne(r => r.TradeOffer)
                .WithMany()
                .HasForeignKey(r => r.TradeOfferId)
                .OnDelete(DeleteBehavior.Cascade);

            // Restrict on the responding team: a FantasyTeam that has
            // ever answered an offer cannot be silently deleted.
            modelBuilder.Entity<TradeOfferResponse>()
                .HasOne(r => r.RespondingFantasyTeam)
                .WithMany()
                .HasForeignKey(r => r.RespondingFantasyTeamId)
                .OnDelete(DeleteBehavior.Restrict);

            // Status is stored as its string name so the DB is readable.
            modelBuilder.Entity<TradeOfferResponse>()
                .Property(r => r.Status)
                .HasConversion<string>();

            // Lookup: "every response on offer X" is the hot path for
            // the "Offres reçues" list. One index is enough.
            modelBuilder.Entity<TradeOfferResponse>()
                .HasIndex(r => new { r.TradeOfferId, r.CreatedAt });

            modelBuilder.Entity<TradeOfferResponseSlot>()
                .HasOne(s => s.TradeOfferResponse)
                .WithMany(r => r.Slots)
                .HasForeignKey(s => s.TradeOfferResponseId)
                .OnDelete(DeleteBehavior.Cascade);

            modelBuilder.Entity<TradeOfferResponseSlot>()
                .HasOne(s => s.RespondingPlayer)
                .WithMany()
                .HasForeignKey(s => s.RespondingPlayerId)
                .OnDelete(DeleteBehavior.Restrict);

            // One pick per slot per response.
            modelBuilder.Entity<TradeOfferResponseSlot>()
                .HasIndex(s => new { s.TradeOfferResponseId, s.SlotIndex })
                .IsUnique();
        }
    }
}