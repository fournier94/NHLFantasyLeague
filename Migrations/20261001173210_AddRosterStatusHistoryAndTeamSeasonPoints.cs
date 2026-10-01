using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddRosterStatusHistoryAndTeamSeasonPoints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // --- New table: RosterStatusHistories -----------------------------
            migrationBuilder.CreateTable(
                name: "RosterStatusHistories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    FantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    RosterStatus = table.Column<string>(type: "text", nullable: false),
                    EffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Note = table.Column<string>(type: "text", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RosterStatusHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RosterStatusHistories_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RosterStatusHistories_FantasyTeams_FantasyTeamId",
                        column: x => x.FantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_RosterStatusHistories_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_PlayerId_SeasonId_EffectiveAt",
                table: "RosterStatusHistories",
                columns: new[] { "PlayerId", "SeasonId", "EffectiveAt" });

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_FantasyTeamId",
                table: "RosterStatusHistories",
                column: "FantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_SeasonId",
                table: "RosterStatusHistories",
                column: "SeasonId");

            // --- New columns on FantasyTeamSeasons ----------------------------
            migrationBuilder.AddColumn<int>(
                name: "TotalFantasyPoints",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<DateTime>(
                name: "TotalFantasyPointsComputedAt",
                table: "FantasyTeamSeasons",
                type: "timestamp with time zone",
                nullable: true);

            // --- Idempotent re-adds for columns that already exist in some
            //     environments (mostly older manual changes applied outside EF).
            //     ADD COLUMN IF NOT EXISTS is standard PostgreSQL.
            //
            // PlayerGameLogs
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerGameLogs"" ADD COLUMN IF NOT EXISTS ""PenaltyMinutes"" integer NOT NULL DEFAULT 0;");
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerGameLogs"" ADD COLUMN IF NOT EXISTS ""PlusMinus"" integer NOT NULL DEFAULT 0;");
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerGameLogs"" ADD COLUMN IF NOT EXISTS ""Shots"" integer NOT NULL DEFAULT 0;");
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerGameLogs"" ADD COLUMN IF NOT EXISTS ""Saves"" integer NOT NULL DEFAULT 0;");
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerGameLogs"" ADD COLUMN IF NOT EXISTS ""SavePercentage"" numeric NOT NULL DEFAULT 0.0;");

            // PlayerCareerStats
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerCareerStats"" ADD COLUMN IF NOT EXISTS ""HatTricks"" integer NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""PlayerCareerStats"" ADD COLUMN IF NOT EXISTS ""HatTricksComputedAt"" timestamp with time zone NULL;");

            // Players
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""DraftYear"" integer NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""DraftTeamAbbreviation"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""DraftRound"" integer NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""DraftPickInRound"" integer NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""DraftOverallPick"" integer NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""CapFreezeName"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""CapFreezeSlug"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""CapFreezeStatusLastUpdated"" timestamp with time zone NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""CapFreezeContractLastUpdated"" timestamp with time zone NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""InjuryType"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""InjuryDetail"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""InjurySide"" text NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""InjuryReturnDate"" date NULL;");
            migrationBuilder.Sql(@"ALTER TABLE ""Players"" ADD COLUMN IF NOT EXISTS ""InjuryFantasyStatus"" text NULL;");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TotalFantasyPointsComputedAt",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "TotalFantasyPoints",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropTable(
                name: "RosterStatusHistories");
        }
    }
}
