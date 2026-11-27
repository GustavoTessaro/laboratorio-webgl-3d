using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Laboratorio.Collaboration.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEnvironmentReceipts : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlServer = ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer";
            migrationBuilder.CreateTable(
                name: "EnvironmentReceipts",
                columns: table => new
                {
                    OperationId = table.Column<Guid>(type: sqlServer ? "uniqueidentifier" : "TEXT", nullable: false),
                    EnvironmentId = table.Column<string>(type: sqlServer ? "nvarchar(32)" : "TEXT", maxLength: 32, nullable: false),
                    Mode = table.Column<string>(type: sqlServer ? "nvarchar(7)" : "TEXT", maxLength: 7, nullable: false),
                    CatalogVersion = table.Column<int>(type: sqlServer ? "int" : "INTEGER", nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_EnvironmentReceipts", x => x.OperationId);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "EnvironmentReceipts");
        }
    }
}
