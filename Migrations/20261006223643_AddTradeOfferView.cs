using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOfferView : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOfferViews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    TradeOfferId = table.Column<int>(type: "integer", nullable: false),
                    SeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferViews_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TradeOfferViews_TradeOffers_TradeOfferId",
                        column: x => x.TradeOfferId,
                        principalTable: "TradeOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferViews_TradeOfferId",
                table: "TradeOfferViews",
                column: "TradeOfferId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferViews_UserId_TradeOfferId",
                table: "TradeOfferViews",
                columns: new[] { "UserId", "TradeOfferId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferViews");
        }
    }
}
