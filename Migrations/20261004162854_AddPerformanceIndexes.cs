using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPerformanceIndexes : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RosterStatusHistories_SeasonId",
                table: "RosterStatusHistories");

            migrationBuilder.DropIndex(
                name: "IX_PlayerGameLogs_SeasonId",
                table: "PlayerGameLogs");

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_SeasonId_EffectiveAt",
                table: "RosterStatusHistories",
                columns: new[] { "SeasonId", "EffectiveAt" });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_SeasonId_GameDate",
                table: "PlayerGameLogs",
                columns: new[] { "SeasonId", "GameDate" });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropIndex(
                name: "IX_RosterStatusHistories_SeasonId_EffectiveAt",
                table: "RosterStatusHistories");

            migrationBuilder.DropIndex(
                name: "IX_PlayerGameLogs_SeasonId_GameDate",
                table: "PlayerGameLogs");

            migrationBuilder.CreateIndex(
                name: "IX_RosterStatusHistories_SeasonId",
                table: "RosterStatusHistories",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_SeasonId",
                table: "PlayerGameLogs",
                column: "SeasonId");
        }
    }
}
