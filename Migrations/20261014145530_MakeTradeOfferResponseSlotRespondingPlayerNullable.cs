using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class MakeTradeOfferResponseSlotRespondingPlayerNullable : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AlterColumn<int>(
                name: "RespondingPlayerId",
                table: "TradeOfferResponseSlots",
                type: "integer",
                nullable: true,
                oldClrType: typeof(int),
                oldType: "integer");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            throw new InvalidOperationException(
                "Rolling back RespondingPlayerId to non-nullable would " +
                "delete every unbalanced direct-offer response slot. " +
                "Restore from a database backup instead.");
        }
    }
}
