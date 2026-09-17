using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPreviousNhlTeamId : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<int>(
                name: "PreviousNhlTeamId",
                table: "Players",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "PreviousNhlTeamId",
                table: "Players");
        }
    }
}
