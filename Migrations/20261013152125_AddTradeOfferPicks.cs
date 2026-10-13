using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOfferPicks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOfferPicks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferId = table.Column<int>(type: "integer", nullable: false),
                    DraftPickId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferPicks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferPicks_DraftPicks_DraftPickId",
                        column: x => x.DraftPickId,
                        principalTable: "DraftPicks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferPicks_TradeOffers_TradeOfferId",
                        column: x => x.TradeOfferId,
                        principalTable: "TradeOffers",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateTable(
                name: "TradeOfferResponsePicks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferResponseId = table.Column<int>(type: "integer", nullable: false),
                    DraftPickId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferResponsePicks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponsePicks_DraftPicks_DraftPickId",
                        column: x => x.DraftPickId,
                        principalTable: "DraftPicks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponsePicks_TradeOfferResponses_TradeOfferRespo~",
                        column: x => x.TradeOfferResponseId,
                        principalTable: "TradeOfferResponses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferPicks_DraftPickId",
                table: "TradeOfferPicks",
                column: "DraftPickId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferPicks_TradeOfferId_DraftPickId",
                table: "TradeOfferPicks",
                columns: new[] { "TradeOfferId", "DraftPickId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponsePicks_DraftPickId",
                table: "TradeOfferResponsePicks",
                column: "DraftPickId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponsePicks_TradeOfferResponseId_DraftPickId",
                table: "TradeOfferResponsePicks",
                columns: new[] { "TradeOfferResponseId", "DraftPickId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferPicks");

            migrationBuilder.DropTable(
                name: "TradeOfferResponsePicks");
        }
    }
}
