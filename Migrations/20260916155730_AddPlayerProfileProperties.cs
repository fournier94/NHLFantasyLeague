using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerProfileProperties : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "BirthCity",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "BirthCountry",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "HeightInInches",
                table: "Players",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "HeroImageUrl",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ShootsCatches",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "WeightInPounds",
                table: "Players",
                type: "integer",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "BirthCity",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "BirthCountry",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "HeightInInches",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "HeroImageUrl",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "ShootsCatches",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "WeightInPounds",
                table: "Players");
        }
    }
}
