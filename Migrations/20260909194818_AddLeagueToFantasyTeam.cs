using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddLeagueToFantasyTeam : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "LeagueId",
                table: "FantasyTeams",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_FantasyTeams_LeagueId",
                table: "FantasyTeams",
                column: "LeagueId");

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyTeams_Leagues_LeagueId",
                table: "FantasyTeams",
                column: "LeagueId",
                principalTable: "Leagues",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_FantasyTeams_Leagues_LeagueId",
                table: "FantasyTeams");

            migrationBuilder.DropIndex(
                name: "IX_FantasyTeams_LeagueId",
                table: "FantasyTeams");

            migrationBuilder.DropColumn(
                name: "LeagueId",
                table: "FantasyTeams");
        }
    }
}
