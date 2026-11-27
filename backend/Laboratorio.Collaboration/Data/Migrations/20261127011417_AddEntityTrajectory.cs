using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Laboratorio.Collaboration.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddEntityTrajectory : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "TrajectoryJson",
                table: "RoomEntities",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer" ? "nvarchar(2048)" : "TEXT",
                maxLength: 2048,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "TrajectoryJson",
                table: "RoomEntities");
        }
    }
}
