using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerDraftInfo : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DraftOverallPick",
                table: "Players",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DraftPickInRound",
                table: "Players",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DraftRound",
                table: "Players",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DraftTeamAbbreviation",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DraftYear",
                table: "Players",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DraftOverallPick",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "DraftPickInRound",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "DraftRound",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "DraftTeamAbbreviation",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "DraftYear",
                table: "Players");
        }
    }
}
