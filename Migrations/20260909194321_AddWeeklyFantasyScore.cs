using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddWeeklyFantasyScore : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "WeeklyFantasyScores",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    Season = table.Column<string>(type: "text", nullable: false),
                    WeekNumber = table.Column<int>(type: "integer", nullable: false),
                    WeekStart = table.Column<DateOnly>(type: "date", nullable: false),
                    WeekEnd = table.Column<DateOnly>(type: "date", nullable: false),
                    NhlPoints = table.Column<int>(type: "integer", nullable: false),
                    HatTrickBonus = table.Column<int>(type: "integer", nullable: false),
                    GoalieWinPoints = table.Column<int>(type: "integer", nullable: false),
                    GoalieOvertimeLossPoints = table.Column<int>(type: "integer", nullable: false),
                    ShutoutBonus = table.Column<int>(type: "integer", nullable: false),
                    TotalFantasyPoints = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_WeeklyFantasyScores", x => x.Id);
                    table.ForeignKey(
                        name: "FK_WeeklyFantasyScores_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_WeeklyFantasyScores_PlayerId",
                table: "WeeklyFantasyScores",
                column: "PlayerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "WeeklyFantasyScores");
        }
    }
}
