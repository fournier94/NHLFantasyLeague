using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeDateChange : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "TradeHistoryId",
                table: "RosterStatusHistories",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateTable(
                name: "TradeDateChanges",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeHistoryId = table.Column<int>(type: "integer", nullable: false),
                    PreviousEffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    NewEffectiveAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ChangedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Reason = table.Column<string>(type: "character varying(500)", maxLength: 500, nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeDateChanges", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeDateChanges_TradeHistories_TradeHistoryId",
                        column: x => x.TradeHistoryId,
                        principalTable: "TradeHistories",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_TradeHistoryId",
                table: "RosterStatusHistories",
                column: "TradeHistoryId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeDateChanges_TradeHistoryId_ChangedAt",
                table: "TradeDateChanges",
                columns: new[] { "TradeHistoryId", "ChangedAt" });

            migrationBuilder.AddForeignKey(
                name: "FK_RosterStatusHistories_TradeHistories_TradeHistoryId",
                table: "RosterStatusHistories",
                column: "TradeHistoryId",
                principalTable: "TradeHistories",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_RosterStatusHistories_TradeHistories_TradeHistoryId",
                table: "RosterStatusHistories");

            migrationBuilder.DropTable(
                name: "TradeDateChanges");

            migrationBuilder.DropIndex(
                name: "IX_RosterStatusHistories_TradeHistoryId",
                table: "RosterStatusHistories");

            migrationBuilder.DropColumn(
                name: "TradeHistoryId",
                table: "RosterStatusHistories");
        }
    }
}
