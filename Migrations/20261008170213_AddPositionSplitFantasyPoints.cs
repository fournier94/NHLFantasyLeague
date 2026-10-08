using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPositionSplitFantasyPoints : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "DefenseFantasyPoints",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ForwardFantasyPoints",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "GoalieFantasyPoints",
                table: "FantasyTeamSeasons",
                type: "integer",
                nullable: false,
                defaultValue: 0);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DefenseFantasyPoints",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "ForwardFantasyPoints",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropColumn(
                name: "GoalieFantasyPoints",
                table: "FantasyTeamSeasons");
        }
    }
}
