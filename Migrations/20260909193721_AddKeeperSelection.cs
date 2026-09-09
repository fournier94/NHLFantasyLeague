using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddKeeperSelection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "KeeperSelections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    FantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    SelectionOrder = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_KeeperSelections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_KeeperSelections_FantasyTeams_FantasyTeamId",
                        column: x => x.FantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_KeeperSelections_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_KeeperSelections_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_KeeperSelections_FantasyTeamId",
                table: "KeeperSelections",
                column: "FantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_KeeperSelections_PlayerId",
                table: "KeeperSelections",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_KeeperSelections_SeasonId",
                table: "KeeperSelections",
                column: "SeasonId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "KeeperSelections");
        }
    }
}
