using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddCapFreezeLastUpdated : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<DateTime>(
                name: "CapFreezeContractLastUpdated",
                table: "Players",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "CapFreezeStatusLastUpdated",
                table: "Players",
                type: "timestamp with time zone",
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "CapFreezeContractLastUpdated",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "CapFreezeStatusLastUpdated",
                table: "Players");
        }
    }
}
