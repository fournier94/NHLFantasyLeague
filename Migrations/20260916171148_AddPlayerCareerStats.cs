using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddPlayerCareerStats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.CreateTable(
                name: "PlayerCareerStats",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    PlayerId = table.Column<int>(type: "integer", nullable: false),
                    Season = table.Column<int>(type: "integer", nullable: false),
                    GameTypeId = table.Column<int>(type: "integer", nullable: false),
                    Sequence = table.Column<int>(type: "integer", nullable: false),
                    LeagueAbbreviation = table.Column<string>(type: "text", nullable: false),
                    TeamName = table.Column<string>(type: "text", nullable: true),
                    GamesPlayed = table.Column<int>(type: "integer", nullable: false),
                    GamesStarted = table.Column<int>(type: "integer", nullable: false),
                    Goals = table.Column<int>(type: "integer", nullable: false),
                    Assists = table.Column<int>(type: "integer", nullable: false),
                    Points = table.Column<int>(type: "integer", nullable: false),
                    PlusMinus = table.Column<int>(type: "integer", nullable: false),
                    PenaltyMinutes = table.Column<int>(type: "integer", nullable: false),
                    PowerPlayGoals = table.Column<int>(type: "integer", nullable: false),
                    PowerPlayPoints = table.Column<int>(type: "integer", nullable: false),
                    ShorthandedGoals = table.Column<int>(type: "integer", nullable: false),
                    ShorthandedPoints = table.Column<int>(type: "integer", nullable: false),
                    GameWinningGoals = table.Column<int>(type: "integer", nullable: false),
                    OvertimeGoals = table.Column<int>(type: "integer", nullable: false),
                    Shots = table.Column<int>(type: "integer", nullable: false),
                    ShootingPercentage = table.Column<decimal>(type: "numeric", nullable: false),
                    AverageTimeOnIce = table.Column<string>(type: "text", nullable: true),
                    FaceoffWinningPercentage = table.Column<decimal>(type: "numeric", nullable: false),
                    Wins = table.Column<int>(type: "integer", nullable: false),
                    Losses = table.Column<int>(type: "integer", nullable: false),
                    OvertimeLosses = table.Column<int>(type: "integer", nullable: false),
                    Shutouts = table.Column<int>(type: "integer", nullable: false),
                    Saves = table.Column<int>(type: "integer", nullable: false),
                    ShotsAgainst = table.Column<int>(type: "integer", nullable: false),
                    SavePercentage = table.Column<decimal>(type: "numeric", nullable: false),
                    GoalsAgainst = table.Column<int>(type: "integer", nullable: false),
                    GoalsAgainstAverage = table.Column<decimal>(type: "numeric", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_PlayerCareerStats", x => x.Id);
                    table.ForeignKey(
                        name: "FK_PlayerCareerStats_Players_PlayerId",
                        column: x => x.PlayerId,
                        principalTable: "Players",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Restrict);
                });

            migrationBuilder.CreateIndex(
                name: "IX_PlayerCareerStats_PlayerId_Season_GameTypeId_Sequence",
                table: "PlayerCareerStats",
                columns: new[] { "PlayerId", "Season", "GameTypeId", "Sequence" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "PlayerCareerStats");
        }
    }
}
