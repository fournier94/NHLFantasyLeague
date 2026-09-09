using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddDraftPick : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DraftPicks",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    SeasonId = table.Column<int>(type: "integer", nullable: false),
                    Round = table.Column<int>(type: "integer", nullable: false),
                    PickNumber = table.Column<int>(type: "integer", nullable: false),
                    CurrentOwnerFantasyTeamId = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DraftPicks", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DraftPicks_FantasyTeams_CurrentOwnerFantasyTeamId",
                        column: x => x.CurrentOwnerFantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DraftPicks_Seasons_SeasonId",
                        column: x => x.SeasonId,
                        principalTable: "Seasons",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DraftPicks_CurrentOwnerFantasyTeamId",
                table: "DraftPicks",
                column: "CurrentOwnerFantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftPicks_SeasonId",
                table: "DraftPicks",
                column: "SeasonId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DraftPicks");
        }
    }
}
