using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOfferResponseViews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOfferResponseViews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    UserId = table.Column<int>(type: "integer", nullable: false),
                    TradeOfferResponseId = table.Column<int>(type: "integer", nullable: false),
                    SeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferResponseViews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseViews_AspNetUsers_UserId",
                        column: x => x.UserId,
                        principalTable: "AspNetUsers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseViews_TradeOfferResponses_TradeOfferRespo~",
                        column: x => x.TradeOfferResponseId,
                        principalTable: "TradeOfferResponses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseViews_TradeOfferResponseId",
                table: "TradeOfferResponseViews",
                column: "TradeOfferResponseId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseViews_UserId_TradeOfferResponseId",
                table: "TradeOfferResponseViews",
                columns: new[] { "UserId", "TradeOfferResponseId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferResponseViews");
        }
    }
}
