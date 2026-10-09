using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddNhlGameStats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "NhlGameStats",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NhlGameId = table.Column<long>(type: "bigint", nullable: false),
                    NhlSeasonCode = table.Column<int>(type: "integer", nullable: false),
                    GameTypeId = table.Column<int>(type: "integer", nullable: false),
                    GameDate = table.Column<DateOnly>(type: "date", nullable: false),
                    AwayNhlTeamId = table.Column<int>(type: "integer", nullable: false),
                    HomeNhlTeamId = table.Column<int>(type: "integer", nullable: false),
                    AwayScore = table.Column<int>(type: "integer", nullable: false),
                    HomeScore = table.Column<int>(type: "integer", nullable: false),
                    AwayShotsOnGoal = table.Column<int>(type: "integer", nullable: false),
                    HomeShotsOnGoal = table.Column<int>(type: "integer", nullable: false),
                    LastUpdatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NhlGameStats", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NhlGameStats_GameDate",
                table: "NhlGameStats",
                column: "GameDate");

            migrationBuilder.CreateIndex(
                name: "IX_NhlGameStats_NhlGameId",
                table: "NhlGameStats",
                column: "NhlGameId",
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NhlGameStats");
        }
    }
}
