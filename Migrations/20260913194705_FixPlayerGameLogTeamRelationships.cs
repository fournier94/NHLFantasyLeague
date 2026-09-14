using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class FixPlayerGameLogTeamRelationships : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "NhlTeamId",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs",
                column: "OpponentNhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "NhlTeamId",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs",
                column: "OpponentNhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }
    }
}
