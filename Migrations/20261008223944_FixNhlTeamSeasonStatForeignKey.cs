using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class FixNhlTeamSeasonStatForeignKey : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NhlTeamSeasonStats_NhlTeams_NhlTeamId",
                table: "NhlTeamSeasonStats");

            migrationBuilder.AddForeignKey(
                name: "FK_NhlTeamSeasonStats_NhlTeams_NhlTeamId",
                table: "NhlTeamSeasonStats",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "NhlTeamId",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_NhlTeamSeasonStats_NhlTeams_NhlTeamId",
                table: "NhlTeamSeasonStats");

            migrationBuilder.AddForeignKey(
                name: "FK_NhlTeamSeasonStats_NhlTeams_NhlTeamId",
                table: "NhlTeamSeasonStats",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
