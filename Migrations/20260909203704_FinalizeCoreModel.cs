using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class FinalizeCoreModel : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DraftPicks_FantasyTeams_CurrentOwnerFantasyTeamId",
                table: "DraftPicks");

            migrationBuilder.DropForeignKey(
                name: "FK_DraftPicks_Seasons_SeasonId",
                table: "DraftPicks");

            migrationBuilder.DropForeignKey(
                name: "FK_DraftSelections_Drafts_DraftId",
                table: "DraftSelections");

            migrationBuilder.DropForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_AwayFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_HomeFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_WinnerFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_TradeItems_FantasyTeams_FromFantasyTeamId",
                table: "TradeItems");

            migrationBuilder.DropForeignKey(
                name: "FK_Trades_FantasyTeams_FromFantasyTeamId",
                table: "Trades");

            migrationBuilder.DropForeignKey(
                name: "FK_Trades_FantasyTeams_ToFantasyTeamId",
                table: "Trades");

            migrationBuilder.DropIndex(
                name: "IX_SeasonStandings_SeasonId",
                table: "SeasonStandings");

            migrationBuilder.DropIndex(
                name: "IX_Seasons_LeagueId",
                table: "Seasons");

            migrationBuilder.DropIndex(
                name: "IX_RosterEntries_SeasonId",
                table: "RosterEntries");

            migrationBuilder.DropIndex(
                name: "IX_KeeperSelections_SeasonId",
                table: "KeeperSelections");

            migrationBuilder.DropIndex(
                name: "IX_FantasyTeamSeasons_FantasyTeamId",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropIndex(
                name: "IX_FantasyTeams_LeagueId",
                table: "FantasyTeams");

            migrationBuilder.DropIndex(
                name: "IX_FantasyMatchups_SeasonId",
                table: "FantasyMatchups");

            migrationBuilder.DropIndex(
                name: "IX_DraftSelections_DraftId",
                table: "DraftSelections");

            migrationBuilder.DropIndex(
                name: "IX_DraftSelections_DraftPickId",
                table: "DraftSelections");

            migrationBuilder.DropColumn(
                name: "Season",
                table: "WeeklyFantasyScores");

            migrationBuilder.DropColumn(
                name: "Season",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "Season",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "DraftId",
                table: "DraftSelections");

            migrationBuilder.DropColumn(
                name: "GamesPlayed",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "SeasonId",
                table: "DraftPicks");

            migrationBuilder.AddColumn<int>(
                name: "SeasonId",
                table: "WeeklyFantasyScores",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SeasonId",
                table: "Trades",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "Status",
                table: "Trades",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "ItemType",
                table: "TradeItems",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SeasonId",
                table: "PlayerSeasonStats",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "NhlPlayerId",
                table: "Players",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "SeasonId",
                table: "PlayerGameLogs",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<bool>(
                name: "GoalieOvertimeLoss",
                table: "PlayerGameLogs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<bool>(
                name: "GoalieWin",
                table: "PlayerGameLogs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<long>(
                name: "NhlGameId",
                table: "PlayerGameLogs",
                type: "bigint",
                nullable: false,
                defaultValue: 0L);

            migrationBuilder.AddColumn<bool>(
                name: "Shutout",
                table: "PlayerGameLogs",
                type: "boolean",
                nullable: false,
                defaultValue: false);

            migrationBuilder.AddColumn<int>(
                name: "NhlTeamId",
                table: "NhlTeams",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "DraftId",
                table: "DraftPicks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.AddColumn<int>(
                name: "OriginalOwnerFantasyTeamId",
                table: "DraftPicks",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_WeeklyFantasyScores_SeasonId_PlayerId_WeekNumber",
                table: "WeeklyFantasyScores",
                columns: new[] { "SeasonId", "PlayerId", "WeekNumber" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Trades_SeasonId",
                table: "Trades",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_SeasonStandings_SeasonId_FantasyTeamId",
                table: "SeasonStandings",
                columns: new[] { "SeasonId", "FantasyTeamId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_LeagueId_Name",
                table: "Seasons",
                columns: new[] { "LeagueId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_RosterEntries_SeasonId_FantasyTeamId_PlayerId",
                table: "RosterEntries",
                columns: new[] { "SeasonId", "FantasyTeamId", "PlayerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlayerSeasonStats_SeasonId_PlayerId",
                table: "PlayerSeasonStats",
                columns: new[] { "SeasonId", "PlayerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_Players_NhlPlayerId",
                table: "Players",
                column: "NhlPlayerId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_SeasonId",
                table: "PlayerGameLogs",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_PlayerGameLogs_PlayerId_NhlGameId",
                table: "PlayerGameLogs",
                columns: new[] { "PlayerId", "NhlGameId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_NhlTeams_NhlTeamId",
                table: "NhlTeams",
                column: "NhlTeamId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_KeeperSelections_SeasonId_FantasyTeamId_PlayerId",
                table: "KeeperSelections",
                columns: new[] { "SeasonId", "FantasyTeamId", "PlayerId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FantasyTeamSeasons_FantasyTeamId_SeasonId",
                table: "FantasyTeamSeasons",
                columns: new[] { "FantasyTeamId", "SeasonId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FantasyTeams_LeagueId_Name",
                table: "FantasyTeams",
                columns: new[] { "LeagueId", "Name" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_SeasonId_WeekNumber_AwayFantasyTeamId",
                table: "FantasyMatchups",
                columns: new[] { "SeasonId", "WeekNumber", "AwayFantasyTeamId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_SeasonId_WeekNumber_HomeFantasyTeamId",
                table: "FantasyMatchups",
                columns: new[] { "SeasonId", "WeekNumber", "HomeFantasyTeamId" },
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_DraftPickId",
                table: "DraftSelections",
                column: "DraftPickId",
                unique: true);

            migrationBuilder.CreateIndex(
                name: "IX_DraftPicks_DraftId_Round_PickNumber",
                table: "DraftPicks",
                columns: new[] { "DraftId", "Round", "PickNumber" },
                unique: true);

            migrationBuilder.AddForeignKey(
                name: "FK_DraftPicks_Drafts_DraftId",
                table: "DraftPicks",
                column: "DraftId",
                principalTable: "Drafts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_DraftPicks_FantasyTeams_CurrentOwnerFantasyTeamId",
                table: "DraftPicks",
                column: "CurrentOwnerFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_DraftPicks_FantasyTeams_OriginalOwnerFantasyTeamId",
                table: "DraftPicks",
                column: "OriginalOwnerFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_AwayFantasyTeamId",
                table: "FantasyMatchups",
                column: "AwayFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_HomeFantasyTeamId",
                table: "FantasyMatchups",
                column: "HomeFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_WinnerFantasyTeamId",
                table: "FantasyMatchups",
                column: "WinnerFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs",
                column: "OpponentNhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_Seasons_SeasonId",
                table: "PlayerGameLogs",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerSeasonStats_Seasons_SeasonId",
                table: "PlayerSeasonStats",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_TradeItems_FantasyTeams_FromFantasyTeamId",
                table: "TradeItems",
                column: "FromFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Trades_FantasyTeams_FromFantasyTeamId",
                table: "Trades",
                column: "FromFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Trades_FantasyTeams_ToFantasyTeamId",
                table: "Trades",
                column: "ToFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);

            migrationBuilder.AddForeignKey(
                name: "FK_Trades_Seasons_SeasonId",
                table: "Trades",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_WeeklyFantasyScores_Seasons_SeasonId",
                table: "WeeklyFantasyScores",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_DraftPicks_Drafts_DraftId",
                table: "DraftPicks");

            migrationBuilder.DropForeignKey(
                name: "FK_DraftPicks_FantasyTeams_CurrentOwnerFantasyTeamId",
                table: "DraftPicks");

            migrationBuilder.DropForeignKey(
                name: "FK_DraftPicks_FantasyTeams_OriginalOwnerFantasyTeamId",
                table: "DraftPicks");

            migrationBuilder.DropForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_AwayFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_HomeFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_WinnerFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerGameLogs_Seasons_SeasonId",
                table: "PlayerGameLogs");

            migrationBuilder.DropForeignKey(
                name: "FK_PlayerSeasonStats_Seasons_SeasonId",
                table: "PlayerSeasonStats");

            migrationBuilder.DropForeignKey(
                name: "FK_TradeItems_FantasyTeams_FromFantasyTeamId",
                table: "TradeItems");

            migrationBuilder.DropForeignKey(
                name: "FK_Trades_FantasyTeams_FromFantasyTeamId",
                table: "Trades");

            migrationBuilder.DropForeignKey(
                name: "FK_Trades_FantasyTeams_ToFantasyTeamId",
                table: "Trades");

            migrationBuilder.DropForeignKey(
                name: "FK_Trades_Seasons_SeasonId",
                table: "Trades");

            migrationBuilder.DropForeignKey(
                name: "FK_WeeklyFantasyScores_Seasons_SeasonId",
                table: "WeeklyFantasyScores");

            migrationBuilder.DropIndex(
                name: "IX_WeeklyFantasyScores_SeasonId_PlayerId_WeekNumber",
                table: "WeeklyFantasyScores");

            migrationBuilder.DropIndex(
                name: "IX_Trades_SeasonId",
                table: "Trades");

            migrationBuilder.DropIndex(
                name: "IX_SeasonStandings_SeasonId_FantasyTeamId",
                table: "SeasonStandings");

            migrationBuilder.DropIndex(
                name: "IX_Seasons_LeagueId_Name",
                table: "Seasons");

            migrationBuilder.DropIndex(
                name: "IX_RosterEntries_SeasonId_FantasyTeamId_PlayerId",
                table: "RosterEntries");

            migrationBuilder.DropIndex(
                name: "IX_PlayerSeasonStats_SeasonId_PlayerId",
                table: "PlayerSeasonStats");

            migrationBuilder.DropIndex(
                name: "IX_Players_NhlPlayerId",
                table: "Players");

            migrationBuilder.DropIndex(
                name: "IX_PlayerGameLogs_SeasonId",
                table: "PlayerGameLogs");

            migrationBuilder.DropIndex(
                name: "IX_NhlTeams_NhlTeamId",
                table: "NhlTeams");

            migrationBuilder.DropIndex(
                name: "IX_KeeperSelections_SeasonId_FantasyTeamId_PlayerId",
                table: "KeeperSelections");

            migrationBuilder.DropIndex(
                name: "IX_FantasyTeamSeasons_FantasyTeamId_SeasonId",
                table: "FantasyTeamSeasons");

            migrationBuilder.DropIndex(
                name: "IX_FantasyTeams_LeagueId_Name",
                table: "FantasyTeams");

            migrationBuilder.DropIndex(
                name: "IX_FantasyMatchups_SeasonId_WeekNumber_AwayFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropIndex(
                name: "IX_FantasyMatchups_SeasonId_WeekNumber_HomeFantasyTeamId",
                table: "FantasyMatchups");

            migrationBuilder.DropIndex(
                name: "IX_DraftSelections_DraftPickId",
                table: "DraftSelections");

            migrationBuilder.DropIndex(
                name: "IX_DraftPicks_DraftId_Round_PickNumber",
                table: "DraftPicks");

            migrationBuilder.DropColumn(
                name: "SeasonId",
                table: "WeeklyFantasyScores");

            migrationBuilder.DropColumn(
                name: "SeasonId",
                table: "Trades");

            migrationBuilder.DropColumn(
                name: "Status",
                table: "Trades");

            migrationBuilder.DropColumn(
                name: "ItemType",
                table: "TradeItems");

            migrationBuilder.DropColumn(
                name: "SeasonId",
                table: "PlayerSeasonStats");

            migrationBuilder.DropColumn(
                name: "NhlPlayerId",
                table: "Players");

            migrationBuilder.DropColumn(
                name: "GoalieOvertimeLoss",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "GoalieWin",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "NhlGameId",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "Shutout",
                table: "PlayerGameLogs");

            migrationBuilder.DropColumn(
                name: "NhlTeamId",
                table: "NhlTeams");

            migrationBuilder.DropColumn(
                name: "DraftId",
                table: "DraftPicks");

            migrationBuilder.RenameColumn(
                name: "SeasonId",
                table: "PlayerGameLogs",
                newName: "GamesPlayed");

            migrationBuilder.RenameColumn(
                name: "OriginalOwnerFantasyTeamId",
                table: "DraftPicks",
                newName: "SeasonId");

            migrationBuilder.RenameIndex(
                name: "IX_DraftPicks_OriginalOwnerFantasyTeamId",
                table: "DraftPicks",
                newName: "IX_DraftPicks_SeasonId");

            migrationBuilder.AddColumn<string>(
                name: "Season",
                table: "WeeklyFantasyScores",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Season",
                table: "PlayerSeasonStats",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<string>(
                name: "Season",
                table: "PlayerGameLogs",
                type: "text",
                nullable: false,
                defaultValue: "");

            migrationBuilder.AddColumn<int>(
                name: "DraftId",
                table: "DraftSelections",
                type: "integer",
                nullable: false,
                defaultValue: 0);

            migrationBuilder.CreateIndex(
                name: "IX_SeasonStandings_SeasonId",
                table: "SeasonStandings",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_Seasons_LeagueId",
                table: "Seasons",
                column: "LeagueId");

            migrationBuilder.CreateIndex(
                name: "IX_RosterEntries_SeasonId",
                table: "RosterEntries",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_KeeperSelections_SeasonId",
                table: "KeeperSelections",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_FantasyTeamSeasons_FantasyTeamId",
                table: "FantasyTeamSeasons",
                column: "FantasyTeamId");

            migrationBuilder.CreateIndex(
                name: "IX_FantasyTeams_LeagueId",
                table: "FantasyTeams",
                column: "LeagueId");

            migrationBuilder.CreateIndex(
                name: "IX_FantasyMatchups_SeasonId",
                table: "FantasyMatchups",
                column: "SeasonId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_DraftId",
                table: "DraftSelections",
                column: "DraftId");

            migrationBuilder.CreateIndex(
                name: "IX_DraftSelections_DraftPickId",
                table: "DraftSelections",
                column: "DraftPickId");

            migrationBuilder.AddForeignKey(
                name: "FK_DraftPicks_FantasyTeams_CurrentOwnerFantasyTeamId",
                table: "DraftPicks",
                column: "CurrentOwnerFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_DraftPicks_Seasons_SeasonId",
                table: "DraftPicks",
                column: "SeasonId",
                principalTable: "Seasons",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_DraftSelections_Drafts_DraftId",
                table: "DraftSelections",
                column: "DraftId",
                principalTable: "Drafts",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_AwayFantasyTeamId",
                table: "FantasyMatchups",
                column: "AwayFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_HomeFantasyTeamId",
                table: "FantasyMatchups",
                column: "HomeFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_FantasyMatchups_FantasyTeams_WinnerFantasyTeamId",
                table: "FantasyMatchups",
                column: "WinnerFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id");

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_NhlTeamId",
                table: "PlayerGameLogs",
                column: "NhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_PlayerGameLogs_NhlTeams_OpponentNhlTeamId",
                table: "PlayerGameLogs",
                column: "OpponentNhlTeamId",
                principalTable: "NhlTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_TradeItems_FantasyTeams_FromFantasyTeamId",
                table: "TradeItems",
                column: "FromFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Trades_FantasyTeams_FromFantasyTeamId",
                table: "Trades",
                column: "FromFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);

            migrationBuilder.AddForeignKey(
                name: "FK_Trades_FantasyTeams_ToFantasyTeamId",
                table: "Trades",
                column: "ToFantasyTeamId",
                principalTable: "FantasyTeams",
                principalColumn: "Id",
                onDelete: ReferentialAction.Cascade);
        }
    }
}
