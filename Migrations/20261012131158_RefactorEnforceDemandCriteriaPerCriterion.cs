using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class RefactorEnforceDemandCriteriaPerCriterion : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.RenameColumn(
                name: "EnforceDemandCriteria",
                table: "TradeOfferSlots",
                newName: "EnforceDemandMinPointsLastYear");

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
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "EnforceDemandMaxAge",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "EnforceDemandMaxSalary",
                table: "TradeOfferSlots");

            migrationBuilder.DropColumn(
                name: "EnforceDemandMinContractYears",
                table: "TradeOfferSlots");

            migrationBuilder.RenameColumn(
                name: "EnforceDemandMinPointsLastYear",
                table: "TradeOfferSlots",
                newName: "EnforceDemandCriteria");
        }
    }
}
