using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddDraftSelection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "DraftSelections",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    DraftId = table.Column<int>(type: "integer", nullable: false),
                    DraftPickId = table.Column<int>(type: "integer", nullable: false),
                    FantasyTeamId = table.Column<int>(type: "integer", nullable: false),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    SelectedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_DraftSelections", x => x.Id);
                    table.ForeignKey(
                        name: "FK_DraftSelections_DraftPicks_DraftPickId",
                        column: x => x.DraftPickId,
                        principalTable: "DraftPicks",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DraftSelections_Drafts_DraftId",
                        column: x => x.DraftId,
                        principalTable: "Drafts",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DraftSelections_FantasyTeams_FantasyTeamId",
                        column: x => x.FantasyTeamId,
                        principalTable: "FantasyTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                    table.ForeignKey(
                        name: "FK_DraftSelections_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_DraftId",
                table: "DraftSelections",
                column: "DraftId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_DraftPickId",
                table: "DraftSelections",
                column: "DraftPickId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_FantasyTeamId",
                table: "DraftSelections",
                column: "FantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_PlayerId",
                table: "DraftSelections",
                column: "PlayerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "DraftSelections");
        }
    }
}
