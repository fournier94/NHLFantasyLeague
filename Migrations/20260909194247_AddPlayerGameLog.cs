using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerGameLog : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PlayerGameLogs",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    Season = table.Column<string>(type: "text", nullable: false),
                    GameDate = table.Column<DateOnly>(type: "date", nullable: false),
                    NhlTeamId = table.Column<int>(type: "integer", nullable: false),
                    OpponentNhlTeamId = table.Column<int>(type: "integer", nullable: false),
                    IsHomeGame = table.Column<bool>(type: "boolean", nullable: false),
                    Goals = table.Column<int>(type: "integer", nullable: false),
                    Assists = table.Column<int>(type: "integer", nullable: false),
                    Points = table.Column<int>(type: "integer", nullable: false),
                    GamesPlayed = table.Column<int>(type: "integer", nullable: false),
                    FantasyPoints = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayerGameLogs", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                        column: x => x.NhlTeamId,
                        principalTable: "NhlTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                        column: x => x.OpponentNhlTeamId,
                        principalTable: "NhlTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_PlayerGameLogs_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_NhlTeamId",
                table: "PlayerGameLogs",
                column: "NhlTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_OpponentNhlTeamId",
                table: "PlayerGameLogs",
                column: "OpponentNhlTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_PlayerId",
                table: "PlayerGameLogs",
                column: "PlayerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlayerGameLogs");
        }
    }
}
