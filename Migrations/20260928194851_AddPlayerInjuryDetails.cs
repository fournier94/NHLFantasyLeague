using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerInjuryDetails : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "InjuryDetail",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InjuryFantasyStatus",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateOnly>(
                name: "InjuryReturnDate",
                table: "Players",
                type: "date",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InjurySide",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InjuryType",
                table: "Players",
                type: "text",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "InjuryDetail",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjuryFantasyStatus",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjuryReturnDate",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjurySide",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjuryType",
                table: "Players");
        }
    }
}
