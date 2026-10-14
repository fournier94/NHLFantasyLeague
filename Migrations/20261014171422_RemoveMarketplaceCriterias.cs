using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class RemoveMarketplaceCriterias : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "DemandMaxAge",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "DemandMaxSalary",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "DemandMinContractYears",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "DemandMinPointsLastYear",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "EnforceDemandMaxAge",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "EnforceDemandMaxSalary",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "EnforceDemandMinContractYears",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "EnforceDemandMinPointsLastYear",
                table: "TradeOfferSlots");

            migrationBuilder.AddColumn<int>(
                name: "OfferingPlayerOverrideId",
                table: "TradeOfferResponseSlots",
                type: "integer",
                nullable: true);

            migrationBuilder.CreateIndex(
                name: "IX_TradeOfferResponseSlots_OfferingPlayerOverrideId",
                table: "TradeOfferResponseSlots",
                column: "OfferingPlayerOverrideId");

            migrationBuilder.AddForeignKey(
                name: "FK_TradeOfferResponseSlots_Players_OfferingPlayerOverrideId",
                table: "TradeOfferResponseSlots",
                column: "OfferingPlayerOverrideId",
                principalTable: "Players",
                principalColumn: "Id",
                onDelete: ReferentialAction.Restrict);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropForeignKey(
                name: "FK_TradeOfferResponseSlots_Players_OfferingPlayerOverrideId",
                table: "TradeOfferResponseSlots");

            migrationBuilder.DropIndex(
                name: "IX_TradeOfferResponseSlots_OfferingPlayerOverrideId",
                table: "TradeOfferResponseSlots");

            migrationBuilder.DropColumn(
                name: "OfferingPlayerOverrideId",
                table: "TradeOfferResponseSlots");

            migrationBuilder.AddColumn<int>(
                name: "DemandMaxAge",
                table: "TradeOfferSlots",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<decimal>(
                name: "DemandMaxSalary",
                table: "TradeOfferSlots",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DemandMinContractYears",
                table: "TradeOfferSlots",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<int>(
                name: "DemandMinPointsLastYear",
                table: "TradeOfferSlots",
                type: "integer",
                nullable: true);

            migrationBuilder.AddColumn<bool>(
                name: "EnforceDemandMaxAge",
                table: "TradeOfferSlots",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "EnforceDemandMaxSalary",
                table: "TradeOfferSlots",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "EnforceDemandMinContractYears",
                table: "TradeOfferSlots",
                type: "boolean",
                nullable: false,
                defaultValue: true);

            migrationBuilder.AddColumn<bool>(
                name: "EnforceDemandMinPointsLastYear",
                table: "TradeOfferSlots",
                type: "boolean",
                nullable: false,
                defaultValue: true);
        }
    }
}
