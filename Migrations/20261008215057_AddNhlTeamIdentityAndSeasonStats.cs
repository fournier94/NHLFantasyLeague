using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class AddNhlTeamIdentityAndSeasonStats : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ArenaCity",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ArenaName",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "CommonName",
                table: "NhlTeams",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "ConferenceAbbreviation",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ConferenceName",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DivisionAbbreviation",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "DivisionName",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FirstSeasonId",
                table: "NhlTeams",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "FranchiseId",
                table: "NhlTeams",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "IsActive",
                table: "NhlTeams",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<string>(
                name: "OfficialSiteUrl",
                table: "NhlTeams",
                type: "text",
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "PlaceName",
                table: "NhlTeams",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.CreateTable(
                name: "NhlTeamSeasonStats",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy", NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NhlTeamId = table.Column<int>(type: "integer", nullable: false),
                    NhlSeasonCode = table.Column<int>(type: "integer", nullable: false),
                    GameTypeId = table.Column<int>(type: "integer", nullable: false),
                    GamesPlayed = table.Column<int>(type: "integer", nullable: false),
                    Wins = table.Column<int>(type: "integer", nullable: false),
                    Losses = table.Column<int>(type: "integer", nullable: false),
                    OtLosses = table.Column<int>(type: "integer", nullable: false),
                    Ties = table.Column<int>(type: "integer", nullable: false),
                    Points = table.Column<int>(type: "integer", nullable: false),
                    PointPctg = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    GamesRemaining = table.Column<int>(type: "integer", nullable: false),
                    GoalsFor = table.Column<int>(type: "integer", nullable: false),
                    GoalsAgainst = table.Column<int>(type: "integer", nullable: false),
                    GoalDifferential = table.Column<int>(type: "integer", nullable: false),
                    HomeWins = table.Column<int>(type: "integer", nullable: false),
                    HomeLosses = table.Column<int>(type: "integer", nullable: false),
                    HomeOtLosses = table.Column<int>(type: "integer", nullable: false),
                    RoadWins = table.Column<int>(type: "integer", nullable: false),
                    RoadLosses = table.Column<int>(type: "integer", nullable: false),
                    RoadOtLosses = table.Column<int>(type: "integer", nullable: false),
                    L10Wins = table.Column<int>(type: "integer", nullable: false),
                    L10Losses = table.Column<int>(type: "integer", nullable: false),
                    L10OtLosses = table.Column<int>(type: "integer", nullable: false),
                    StreakCode = table.Column<string>(type: "text", nullable: true),
                    StreakCount = table.Column<int>(type: "integer", nullable: false),
                    LeagueSequence = table.Column<int>(type: "integer", nullable: false),
                    ConferenceSequence = table.Column<int>(type: "integer", nullable: false),
                    DivisionSequence = table.Column<int>(type: "integer", nullable: false),
                    WildcardSequence = table.Column<int>(type: "integer", nullable: false),
                    ClinchIndicator = table.Column<string>(type: "text", nullable: true),
                    WildcardIndicator = table.Column<bool>(type: "boolean", nullable: false),
                    ShootoutWins = table.Column<int>(type: "integer", nullable: false),
                    ShootoutLosses = table.Column<int>(type: "integer", nullable: false),
                    PowerPlayPct = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    PowerPlayNetPct = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    PenaltyKillPct = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    PenaltyKillNetPct = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    FaceoffWinPct = table.Column<decimal>(type: "numeric(6,3)", precision: 6, scale: 3, nullable: false),
                    ShotsForPerGame = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    ShotsAgainstPerGame = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    GoalsForPerGame = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    GoalsAgainstPerGame = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    PenaltyMinutesPerGame = table.Column<decimal>(type: "numeric(6,2)", precision: 6, scale: 2, nullable: false),
                    LastUpdatedUtc = table.Column<DateTime>(type: "timestamp with time zone", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_NhlTeamSeasonStats", x => x.Id);
                    table.ForeignKey(
                        name: "FK_NhlTeamSeasonStats_NhlTeams_NhlTeamId",
                        column: x => x.NhlTeamId,
                        principalTable: "NhlTeams",
                        principalColumn: "Id",
                        onDelete: ReferentialAction.Cascade);
                });

            migrationBuilder.CreateIndex(
                name: "IX_NhlTeamSeasonStats_NhlTeamId_NhlSeasonCode_GameTypeId",
                table: "NhlTeamSeasonStats",
                columns: new[] { "NhlTeamId", "NhlSeasonCode", "GameTypeId" },
                unique: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "NhlTeamSeasonStats");

            migrationBuilder.DropColumn(
                name: "ArenaCity",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "ArenaName",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "CommonName",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "ConferenceAbbreviation",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "ConferenceName",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "DivisionAbbreviation",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "DivisionName",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "FirstSeasonId",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "FranchiseId",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "IsActive",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "OfficialSiteUrl",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "PlaceName",
                table: "NhlTeams");
        }
    }
}
