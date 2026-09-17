using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddCapFreezePlayerReviews : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "CapFreezePlayerReviews",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    CapFreezeName = table.Column<string>(type: "text", nullable: false),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    FullNameSimilarity = table.Column<double>(type: "double precision", precision: 5, scale: 4, nullable: false),
                    FirstNameSimilarity = table.Column<double>(type: "double precision", precision: 5, scale: 4, nullable: false),
                    LastNameSimilarity = table.Column<double>(type: "double precision", precision: 5, scale: 4, nullable: false),
                    NhlTeamId = table.Column<int>(type: "integer", nullable: false),
                    IsReviewed = table.Column<bool>(type: "boolean", nullable: false),
                    IsApproved = table.Column<bool>(type: "boolean", nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: false),
                    ReviewedAt = table.Column<DateTime>(type: "timestamp with time zone", nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_CapFreezePlayerReviews", x => x.Id);
                    table.ForeignKey(
                        name: "FK_CapFreezePlayerReviews_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_CapFreezePlayerReviews_CapFreezeName_PlayerId",
                table: "CapFreezePlayerReviews",
                columns: new[] { "CapFreezeName", "PlayerId" });

            migrationBuilder.CreateIndex(
                name: "IX_CapFreezePlayerReviews_PlayerId",
                table: "CapFreezePlayerReviews",
                column: "PlayerId");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "CapFreezePlayerReviews");
        }
    }
}
