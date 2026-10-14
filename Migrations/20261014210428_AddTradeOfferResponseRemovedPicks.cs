using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeOfferResponseRemovedPicks : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeOfferResponseRemovedPicks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeOfferResponseId = table.Column<int>(type: "integer", nullable: false),
                    DraftPickId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeOfferResponseRemovedPicks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseRemovedPicks_DraftPicks_DraftPickId",
                        column: x => x.DraftPickId,
                        principalTable: "DraftPicks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                    table.ForeignKey(
                        name: "FK_TradeOfferResponseRemovedPicks_TradeOfferResponses_TradeOff~",
                        column: x => x.TradeOfferResponseId,
                        principalTable: "TradeOfferResponses",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseRemovedPicks_DraftPickId",
                table: "TradeOfferResponseRemovedPicks",
                column: "DraftPickId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseRemovedPicks_TradeOfferResponseId_DraftPi~",
                table: "TradeOfferResponseRemovedPicks",
                columns: new[] { "TradeOfferResponseId", "DraftPickId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeOfferResponseRemovedPicks");
        }
    }
}
