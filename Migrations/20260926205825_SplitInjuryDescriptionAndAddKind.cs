using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class SplitInjuryDescriptionAndAddKind : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "InjuryDescription",
                table: "Players",
                newName: "InjuryShortDescription");

            migrationBuilder.AddColumn<int>(
                name: "InjuryKind",
                table: "Players",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<string>(
                name: "InjuryLongDescription",
                table: "Players",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "InjuryKind",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjuryLongDescription",
                table: "Players");

            migrationBuilder.RenameColumn(
                name: "InjuryShortDescription",
                table: "Players",
                newName: "InjuryDescription");
        }
    }
}
