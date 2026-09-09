using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddRosterEntry : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "RosterEntries",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    FantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    RosterStatus = table.Column<string>(type: "text", nullable: false),
                    FantasySalary = table.Column<decimal>(type: "numeric", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RosterEntries", x => x.Id);
                    table.ForeignKey(
                        name: "FK_RosterEntries_FantasyTeams_FantasyTeamId",
                        column: x => x.FantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RosterEntries_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_RosterEntries_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_RosterEntries_FantasyTeamId",
                table: "RosterEntries",
                column: "FantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_RosterEntries_PlayerId",
                table: "RosterEntries",
                column: "PlayerId");

            migrationBuilder.CreateIndex(
                name: "IX_RosterEntries_SeasonId",
                table: "RosterEntries",
                column: "SeasonId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RosterEntries");
        }
    }
}
