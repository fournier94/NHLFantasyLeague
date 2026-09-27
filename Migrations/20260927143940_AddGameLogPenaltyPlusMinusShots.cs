using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddGameLogPenaltyPlusMinusShots : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PenaltyMinutes",
                table: "PlayerGameLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "PlusMinus",
                table: "PlayerGameLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Shots",
                table: "PlayerGameLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PenaltyMinutes",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "PlusMinus",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "Shots",
                table: "PlayerGameLogs");
        }
    }
}
