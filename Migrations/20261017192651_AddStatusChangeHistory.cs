using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddStatusChangeHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "StatusChangeHistoryId",
                table: "RosterStatusHistories",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "StatusChangeHistories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    FantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    StatusAName = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    StatusBName = table.Column<string>(type: "character varying(20)", maxLength: 20, nullable: false),
                    EffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SnapshotJson = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StatusChangeHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StatusChangeHistories_FantasyTeams_FantasyTeamId",
                        column: x => x.FantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_StatusChangeHistories_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "StatusChangeDateChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    StatusChangeHistoryId = table.Column<int>(type: "integer", nullable: false),
                    PreviousEffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NewEffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_StatusChangeDateChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_StatusChangeDateChanges_StatusChangeHistories_StatusChangeH~",
                        column: x => x.StatusChangeHistoryId,
                        principalTable: "StatusChangeHistories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_StatusChangeHistoryId",
                table: "RosterStatusHistories",
                column: "StatusChangeHistoryId");

            migrationBuilder.CreateIndex(
                name: "IX_StatusChangeDateChanges_StatusChangeHistoryId_ChangedAt",
                table: "StatusChangeDateChanges",
                columns: new[] { "StatusChangeHistoryId", "ChangedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_StatusChangeHistories_FantasyTeamId",
                table: "StatusChangeHistories",
                column: "FantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_StatusChangeHistories_SeasonId_ConfirmedAt",
                table: "StatusChangeHistories",
                columns: new[] { "SeasonId", "ConfirmedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_RosterStatusHistories_StatusChangeHistories_StatusChangeHis~",
                table: "RosterStatusHistories",
                column: "StatusChangeHistoryId",
                principalTable: "StatusChangeHistories",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RosterStatusHistories_StatusChangeHistories_StatusChangeHis~",
                table: "RosterStatusHistories");

            migrationBuilder.DropTable(
                name: "StatusChangeDateChanges");

            migrationBuilder.DropTable(
                name: "StatusChangeHistories");

            migrationBuilder.DropIndex(
                name: "IX_RosterStatusHistories_StatusChangeHistoryId",
                table: "RosterStatusHistories");

            migrationBuilder.DropColumn(
                name: "StatusChangeHistoryId",
                table: "RosterStatusHistories");
        }
    }
}
