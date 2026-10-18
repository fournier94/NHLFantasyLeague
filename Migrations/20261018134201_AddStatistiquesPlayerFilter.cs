using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddStatistiquesPlayerFilter : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "StatistiquesPlayerFilter",
                table: "AspNetUsers",
                type: "text",
                nullable: false,
                defaultValue: "rostered");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "StatistiquesPlayerFilter",
                table: "AspNetUsers");
        }
    }
}