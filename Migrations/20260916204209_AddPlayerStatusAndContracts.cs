using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerStatusAndContracts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "IsRfa",
                table: "Players");

            migrationBuilder.AddColumn<string>(
                name: "Status",
                table: "Players",
                type: "text",
                nullable: false,
                defaultValue: "Unsigned");

            migrationBuilder.CreateTable(
                name: "PlayerContracts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    StartSeason = table.Column<int>(type: "integer", nullable: false),
                    EndSeason = table.Column<int>(type: "integer", nullable: false),
                    Salary = table.Column<decimal>(type: "numeric(18,2)", precision: 18, scale: 2, nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayerContracts", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayerContracts_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerContracts_PlayerId_StartSeason",
                table: "PlayerContracts",
                columns: new[] { "PlayerId", "StartSeason" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlayerContracts");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Players");

            migrationBuilder.AddColumn<bool>(
                name: "IsRfa",
                table: "Players",
                type: "boolean",
                nullable: false,
                defaultValue: false);
        }
    }
}
