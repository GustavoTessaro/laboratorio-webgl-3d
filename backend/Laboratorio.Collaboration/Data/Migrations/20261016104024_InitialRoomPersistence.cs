using System;
using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Laboratorio.Collaboration.Data.Migrations
{
    /// <inheritdoc />
    public partial class InitialRoomPersistence : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            var sqlServer = ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer";
            migrationBuilder.CreateTable(
                name: "Rooms",
                columns: table => new
                {
                    RoomId = table.Column<string>(
                        type: sqlServer ? "nvarchar(128)" : "TEXT",
                        maxLength: 128,
                        nullable: false),
                    UpdatedAtUtc = table.Column<DateTime>(
                        type: sqlServer ? "datetime2" : "TEXT",
                        nullable: false)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_Rooms", x => x.RoomId);
                });

            migrationBuilder.CreateTable(
                name: "RoomEntities",
                columns: table => new
                {
                    RoomId = table.Column<string>(
                        type: sqlServer ? "nvarchar(128)" : "TEXT",
                        maxLength: 128,
                        nullable: false),
                    Id = table.Column<string>(
                        type: sqlServer ? "nvarchar(36)" : "TEXT",
                        maxLength: 36,
                        nullable: false),
                    Name = table.Column<string>(
                        type: sqlServer ? "nvarchar(64)" : "TEXT",
                        maxLength: 64,
                        nullable: false),
                    Type = table.Column<string>(
                        type: sqlServer ? "nvarchar(16)" : "TEXT",
                        maxLength: 16,
                        nullable: false),
                    Color = table.Column<string>(
                        type: sqlServer ? "nvarchar(7)" : "TEXT",
                        maxLength: 7,
                        nullable: false),
                    MaterialMode = table.Column<string>(
                        type: sqlServer ? "nvarchar(16)" : "TEXT",
                        maxLength: 16,
                        nullable: false),
                    PositionX = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    PositionY = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    PositionZ = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    RotationX = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    RotationY = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    RotationZ = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    ScaleX = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    ScaleY = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    ScaleZ = table.Column<double>(type: sqlServer ? "float" : "REAL", nullable: false),
                    AnimationEnabled = table.Column<bool>(
                        type: sqlServer ? "bit" : "INTEGER",
                        nullable: false),
                    AnimationAxis = table.Column<string>(
                        type: sqlServer ? "nvarchar(1)" : "TEXT",
                        maxLength: 1,
                        nullable: false),
                    AnimationSpeed = table.Column<double>(
                        type: sqlServer ? "float" : "REAL",
                        nullable: false),
                    LastEditor = table.Column<string>(
                        type: sqlServer ? "nvarchar(32)" : "TEXT",
                        maxLength: 32,
                        nullable: true)
                },
                constraints: table =>
                {
                    table.PrimaryKey("PK_RoomEntities", x => new { x.RoomId, x.Id });
                    table.ForeignKey(
                        name: "FK_RoomEntities_Rooms_RoomId",
                        column: x => x.RoomId,
                        principalTable: "Rooms",
                        principalColumn: "RoomId",
                        onDelete: ReferentialAction.Cascade);
                });
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropTable(
                name: "RoomEntities");

            migrationBuilder.DropTable(
                name: "Rooms");
        }
    }
}
