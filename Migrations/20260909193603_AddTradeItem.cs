using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddTradeItem : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "TradeItems",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    TradeId = table.Column<int>(type: "integer", nullable: false),
                    FromFantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    PlayerId = table.Column<int>(type: "integer", nullable: true),
                    DraftPickId = table.Column<int>(type: "integer", nullable: true),
                    IsProspect = table.Column<bool>(type: "boolean", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_TradeItems", x => x.Id);
                    table.ForeignKey(
                        name: "FK_TradeItems_DraftPicks_DraftPickId",
                        column: x => x.DraftPickId,
                        principalTable: "DraftPicks",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_TradeItems_FantasyTeams_FromFantasyTeamId",
                        column: x => x.FromFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_TradeItems_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_TradeItems_Trades_TradeId",
                        column: x => x.TradeId,
                        principalTable: "Trades",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_TradeItems_DraftPickId",
                table: "TradeItems",
                column: "DraftPickId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeItems_FromFantasyTeamId",
                table: "TradeItems",
                column: "FromFantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeItems_PlayerId",
                table: "TradeItems",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_TradeItems_TradeId",
                table: "TradeItems",
                column: "TradeId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "TradeItems");
        }
    }
}
