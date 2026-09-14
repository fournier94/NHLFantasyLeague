using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class FixPlayerNhlTeamRelationship : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Players_NhlTeams_NhlTeamId",
                table: "Players");

            migrationBuilder.AddUniqueConstraint(
                name: "AK_NhlTeams_NhlTeamId",
                table: "NhlTeams",
                column: "NhlTeamId");

            migrationBuilder.AddForeignKey(
                name: "FK_Players_NhlTeams_NhlTeamId",
                table: "Players",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "NhlTeamId",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_Players_NhlTeams_NhlTeamId",
                table: "Players");

            migrationBuilder.DropIndex(
                name: "IX_PlayerGameLogs_PlayerId_NhlGameId",
                table: "PlayerGameLogs");

            migrationBuilder.DropUniqueConstraint(
                name: "AK_NhlTeams_NhlTeamId",
                table: "NhlTeams");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_PlayerId",
                table: "PlayerGameLogs",
                column: "PlayerId");

            migrationBuilder.AddForeignKey(
                name: "FK_Players_NhlTeams_NhlTeamId",
                table: "Players",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id");
        }
    }
}
