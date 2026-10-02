using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddFantasyTeamSeasonAggregates : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<string>(
                name: "RosterStatus",
                table: "RosterStatusHistories",
                type: "text",
                nullable: false,
                oldClrType: typeof(int),
                oldType: "integer");

            migrationBuilder.AddColumn<int>(
                name: "GoalieGamesPlayed",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GoalieLosses",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GoalieOvertimeLosses",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GoalieShutouts",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GoalieWins",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SkaterAssists",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SkaterGamesPlayed",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SkaterGoals",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SkaterHatTricks",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SkaterPoints",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GoalieGamesPlayed",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "GoalieLosses",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "GoalieOvertimeLosses",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "GoalieShutouts",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "GoalieWins",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "SkaterAssists",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "SkaterGamesPlayed",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "SkaterGoals",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "SkaterHatTricks",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "SkaterPoints",
                table: "FantasyTeamSeasons");

            migrationBuilder.AlterColumn<int>(
                name: "RosterStatus",
                table: "RosterStatusHistories",
                type: "integer",
                nullable: false,
                oldClrType: typeof(string),
                oldType: "text");
        }
    }
}
