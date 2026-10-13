using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOfferResponseRequestedPicks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOfferResponseRequestedPicks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferResponseId = table.Column<int>(type: "integer", nullable: false),
                    DraftPickId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferResponseRequestedPicks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseRequestedPicks_DraftPicks_DraftPickId",
                        column: x => x.DraftPickId,
                        principalTable: "DraftPicks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseRequestedPicks_TradeOfferResponses_TradeO~",
                        column: x => x.TradeOfferResponseId,
                        principalTable: "TradeOfferResponses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseRequestedPicks_DraftPickId",
                table: "TradeOfferResponseRequestedPicks",
                column: "DraftPickId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseRequestedPicks_TradeOfferResponseId_Draft~",
                table: "TradeOfferResponseRequestedPicks",
                columns: new[] { "TradeOfferResponseId", "DraftPickId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferResponseRequestedPicks");
        }
    }
}
