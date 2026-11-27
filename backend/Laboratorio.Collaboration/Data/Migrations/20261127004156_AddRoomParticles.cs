using Microsoft.EntityFrameworkCore.Migrations;

#nullable disable

namespace Laboratorio.Collaboration.Data.Migrations
{
    /// <inheritdoc />
    public partial class AddRoomParticles : Migration
    {
        /// <inheritdoc />
        protected override void Up(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.AddColumn<string>(
                name: "ParticlesJson",
                table: "Rooms",
                type: ActiveProvider == "Microsoft.EntityFrameworkCore.SqlServer" ? "nvarchar(2048)" : "TEXT",
                maxLength: 2048,
                nullable: true);
        }

        /// <inheritdoc />
        protected override void Down(MigrationBuilder migrationBuilder)
        {
            migrationBuilder.DropColumn(
                name: "ParticlesJson",
                table: "Rooms");
        }
    }
}
