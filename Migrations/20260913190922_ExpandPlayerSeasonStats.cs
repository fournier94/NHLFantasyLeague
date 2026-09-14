using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class ExpandPlayerSeasonStats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "GameWinningGoals",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "GoalsAgainstAverage",
                table: "PlayerSeasonStats",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "Losses",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "PenaltyMinutes",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "PlusMinus",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "PowerPlayGoals",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "PowerPlayPoints",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "SavePercentage",
                table: "PlayerSeasonStats",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "Saves",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<decimal>(
                name: "ShootingPercentage",
                table: "PlayerSeasonStats",
                type: "numeric",
                nullable: false,
                defaultValue: 0m);

            migrationBuilder.AddColumn<int>(
                name: "Shots",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ShotsAgainst",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GameWinningGoals",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "GoalsAgainstAverage",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "Losses",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "PenaltyMinutes",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "PlusMinus",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "PowerPlayGoals",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "PowerPlayPoints",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "SavePercentage",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "Saves",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "ShootingPercentage",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "Shots",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "ShotsAgainst",
                table: "PlayerSeasonStats");
        }
    }
}
