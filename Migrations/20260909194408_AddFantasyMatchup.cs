using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddFantasyMatchup : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "FantasyMatchups",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    WeekNumber = table.Column<int>(type: "integer", nullable: false),
                    WeekStart = table.Column<DateOnly>(type: "date", nullable: false),
                    WeekEnd = table.Column<DateOnly>(type: "date", nullable: false),
                    HomeFantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    AwayFantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    HomeScore = table.Column<int>(type: "integer", nullable: false),
                    AwayScore = table.Column<int>(type: "integer", nullable: false),
                    WinnerFantasyTeamId = table.Column<int>(type: "integer", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_FantasyMatchups", x => x.Id);
                    table.ForeignKey(
                        name: "FK_FantasyMatchups_FantasyTeams_AwayFantasyTeamId",
                        column: x => x.AwayFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FantasyMatchups_FantasyTeams_HomeFantasyTeamId",
                        column: x => x.HomeFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_FantasyMatchups_FantasyTeams_WinnerFantasyTeamId",
                        column: x => x.WinnerFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id");
                    table.ForeignKey(
                        name: "FK_FantasyMatchups_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_AwayFantasyTeamId",
                table: "FantasyMatchups",
                column: "AwayFantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_HomeFantasyTeamId",
                table: "FantasyMatchups",
                column: "HomeFantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_SeasonId",
                table: "FantasyMatchups",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_WinnerFantasyTeamId",
                table: "FantasyMatchups",
                column: "WinnerFantasyTeamId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "FantasyMatchups");
        }
    }
}
