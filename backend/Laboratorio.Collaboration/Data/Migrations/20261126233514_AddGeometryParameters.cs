using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Laboratorio.Collaboration.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddGeometryParameters : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "GeometryParametersJson",
                table: "RoomEntities",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer" ? "nvarchar(1024)" : "TEXT",
                maxLength: 1024,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "GeometryParametersJson",
                table: "RoomEntities");
        }
    }
}
