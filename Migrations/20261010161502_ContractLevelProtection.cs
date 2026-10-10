using System;
using Microsoft.EntityFrameworkCore.Migrations;
using Npgsql.EntityFrameworkCore.PostgreSQL.Metadata;

#nullable disable

namespace NhlFantasyLeague.api.Migrations
{
    /// <inheritdoc />
    public partial class ContractLevelProtection : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            // 1. Add the two new columns on PlayerContracts.
            migrationBuilder.AddColumn<decimal>(
                name: "ProtectedSalary",
                table: "PlayerContracts",
                type: "numeric(18,2)",
                precision: 18,
                scale: 2,
                nullable: true);

            migrationBuilder.AddColumn<string>(
                name: "ProtectionNote",
                table: "PlayerContracts",
                type: "character varying(500)",
                maxLength: 500,
                nullable: true);

            // 2. Migrate any existing locks from the old per-player table
            //    to the new per-contract columns. For each row in
            //    ProtectedPlayerContracts, find the PlayerContract that
            //    covers the current season and set its ProtectedSalary.
            //    Rows whose player has no covering contract are dropped
            //    silently.
            migrationBuilder.Sql(@"
        UPDATE ""PlayerContracts"" pc
        SET ""ProtectedSalary"" = ppc.""Salary"",
            ""ProtectionNote""  = ppc.""Note""
        FROM ""ProtectedPlayerContracts"" ppc
        JOIN ""Players"" p ON p.""NhlPlayerId"" = ppc.""NhlPlayerId""
        WHERE pc.""PlayerId"" = p.""Id""
          AND pc.""StartSeason"" <= 20262027
          AND pc.""EndSeason""   >= 20262027
          AND pc.""Id"" = (
              SELECT pc2.""Id""
              FROM ""PlayerContracts"" pc2
              WHERE pc2.""PlayerId"" = pc.""PlayerId""
                AND pc2.""StartSeason"" <= 20262027
                AND pc2.""EndSeason""   >= 20262027
              ORDER BY pc2.""StartSeason""
              LIMIT 1
          );
    ");

            // 3. Drop the old table.
            migrationBuilder.DropTable(
                name: "ProtectedPlayerContracts");
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            // Reverse: recreate the old table and drop the new columns.
            // No data migration on the way down — the old table's schema
            // can't hold everything (a per-contract value can't map cleanly
            // back to a per-player row), so we just bring the schema back.
            migrationBuilder.CreateTable(
                name: "ProtectedPlayerContracts",
                columns: table => new
                {
                    Id = table.Column<int>(type: "integer", nullable: false)
                        .Annotation("Npgsql:ValueGenerationStrategy",
                            NpgsqlValueGenerationStrategy.IdentityByDefaultColumn),
                    NhlPlayerId = table.Column<int>(type: "integer", nullable: false),
                    Salary = table.Column<decimal>(type: "numeric(18,2)",
                        precision: 18, scale: 2, nullable: false),
                    Note = table.Column<string>(type: "character varying(500)",
                        maxLength: 500, nullable: true),
                    CreatedAt = table.Column<DateTime>(type: "timestamp with time zone",
                        nullable: false),
                    UpdatedAt = table.Column<DateTime>(type: "timestamp with time zone",
                        nullable: false),
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_ProtectedPlayerContracts", x => x.Id);
                });

            migrationBuilder.CreateIndex(
                name: "IX_ProtectedPlayerContracts_NhlPlayerId",
                table: "ProtectedPlayerContracts",
                column: "NhlPlayerId",
                unique: true);

            migrationBuilder.DropColumn(
                name: "ProtectedSalary",
                table: "PlayerContracts");

            migrationBuilder.DropColumn(
                name: "ProtectionNote",
                table: "PlayerContracts");
        }
    }
}
