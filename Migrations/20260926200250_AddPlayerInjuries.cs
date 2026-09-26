using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerInjuries : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "InjuryDescription",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "InjuryStatus",
                table: "Players",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<DateTime>(
                name: "InjuryUpdatedAt",
                table: "Players",
                type: "timestamp with time zone",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsInjured",
                table: "Players",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.CreateTable(
                name: "PlayerInjuryHistories",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    InjuryStatus = table.Column<string>(type: "text", nullable: false),
                    InjuryDescription = table.Column<string>(type: "text", nullable: true),
                    TeamAbbreviation = table.Column<string>(type: "text", nullable: false),
                    FirstSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    LastSeenAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ResolvedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayerInjuryHistories", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayerInjuryHistories_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerInjuryHistories_PlayerId_InjuryStatus_TeamAbbreviation",
                table: "PlayerInjuryHistories",
                columns: new[] { "PlayerId", "InjuryStatus", "TeamAbbreviation" },
                unique: true,
                filter: "\"ResolvedAt\" IS NULL");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlayerInjuryHistories");

            migrationBuilder.DropColumn(
                name: "InjuryDescription",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjuryStatus",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "InjuryUpdatedAt",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "IsInjured",
                table: "Players");
        }
    }
}
