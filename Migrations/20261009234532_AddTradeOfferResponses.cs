using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOfferResponses : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOfferResponses",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferId = table.Column<int>(type: "integer", nullable: false),
                    RespondingFantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferResponses", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponses_FantasyTeams_RespondingFantasyTeamId",
                        column: x => x.RespondingFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponses_TradeOffers_TradeOfferId",
                        column: x => x.TradeOfferId,
                        principalTable: "TradeOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TradeOfferResponseSlots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferResponseId = table.Column<int>(type: "integer", nullable: false),
                    SlotIndex = table.Column<int>(type: "integer", nullable: false),
                    RespondingPlayerId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferResponseSlots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseSlots_Players_RespondingPlayerId",
                        column: x => x.RespondingPlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseSlots_TradeOfferResponses_TradeOfferRespo~",
                        column: x => x.TradeOfferResponseId,
                        principalTable: "TradeOfferResponses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponses_RespondingFantasyTeamId",
                table: "TradeOfferResponses",
                column: "RespondingFantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponses_TradeOfferId_CreatedAt",
                table: "TradeOfferResponses",
                columns: new[] { "TradeOfferId", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseSlots_RespondingPlayerId",
                table: "TradeOfferResponseSlots",
                column: "RespondingPlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseSlots_TradeOfferResponseId_SlotIndex",
                table: "TradeOfferResponseSlots",
                columns: new[] { "TradeOfferResponseId", "SlotIndex" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferResponseSlots");

            migrationBuilder.DropTable(
                name: "TradeOfferResponses");
        }
    }
}
