using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOffers : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOffers",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CreatedByFantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    Note = table.Column<string>(type: "character varying(1000)", maxLength: 1000, nullable: true),
                    Status = table.Column<string>(type: "text", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOffers", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOffers_FantasyTeams_CreatedByFantasyTeamId",
                        column: x => x.CreatedByFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOffers_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateTable(
                name: "TradeOfferSlots",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferId = table.Column<int>(type: "integer", nullable: false),
                    SlotIndex = table.Column<int>(type: "integer", nullable: false),
                    PositionGroup = table.Column<string>(type: "character varying(1)", maxLength: 1, nullable: false),
                    OfferingPlayerId = table.Column<int>(type: "integer", nullable: true),
                    DemandMinContractYears = table.Column<int>(type: "integer", nullable: true),
                    DemandMaxSalary = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: true),
                    DemandMaxAge = table.Column<int>(type: "integer", nullable: true),
                    DemandMinPointsLastYear = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferSlots", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferSlots_Players_OfferingPlayerId",
                        column: x => x.OfferingPlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferSlots_TradeOffers_TradeOfferId",
                        column: x => x.TradeOfferId,
                        principalTable: "TradeOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOffers_CreatedByFantasyTeamId",
                table: "TradeOffers",
                column: "CreatedByFantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOffers_SeasonId",
                table: "TradeOffers",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOffers_Status_CreatedAt",
                table: "TradeOffers",
                columns: new[] { "Status", "CreatedAt" });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferSlots_OfferingPlayerId",
                table: "TradeOfferSlots",
                column: "OfferingPlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferSlots_TradeOfferId_SlotIndex",
                table: "TradeOfferSlots",
                columns: new[] { "TradeOfferId", "SlotIndex" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferSlots");

            migrationBuilder.DropTable(
                name: "TradeOffers");
        }
    }
}
