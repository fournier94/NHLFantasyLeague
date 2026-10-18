using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeHistory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeHistories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    TeamAId = table.Column<int>(type: "integer", nullable: false),
                    TeamBId = table.Column<int>(type: "integer", nullable: false),
                    EffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ConfirmedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Note = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true),
                    SnapshotJson = table.Column<string>(type: "jsonb", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeHistories_FantasyTeams_TeamAId",
                        column: x => x.TeamAId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeHistories_FantasyTeams_TeamBId",
                        column: x => x.TeamBId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeHistories_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeHistories_SeasonId_ConfirmedAt",
                table: "TradeHistories",
                columns: new[] { "SeasonId", "ConfirmedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TradeHistories_TeamAId",
                table: "TradeHistories",
                column: "TeamAId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeHistories_TeamBId",
                table: "TradeHistories",
                column: "TeamBId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeHistories");
        }
    }
}
