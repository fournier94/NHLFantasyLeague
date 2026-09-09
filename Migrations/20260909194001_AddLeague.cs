using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddLeague : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "Leagues",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    Name = table.Column<string>(type: "text", nullable: false),
                    MaximumRosterSize = table.Column<int>(type: "integer", nullable: false),
                    ActiveForwardCount = table.Column<int>(type: "integer", nullable: false),
                    ActiveDefensemanCount = table.Column<int>(type: "integer", nullable: false),
                    ActiveGoalieCount = table.Column<int>(type: "integer", nullable: false),
                    BenchForwardCount = table.Column<int>(type: "integer", nullable: false),
                    BenchDefensemanCount = table.Column<int>(type: "integer", nullable: false),
                    BenchGoalieCount = table.Column<int>(type: "integer", nullable: false),
                    ProspectCount = table.Column<int>(type: "integer", nullable: false),
                    KeeperCount = table.Column<int>(type: "integer", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Leagues", x => x.Id);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "Leagues");
        }
    }
}
