using Microsoft.EntityFrameworkCore;

namespace Laboratorio.Collaboration.Data;

public sealed class RoomDbContext(DbContextOptions<RoomDbContext> options) : DbContext(options)
{
    public DbSet<RoomRecord> Rooms => Set<RoomRecord>();
    public DbSet<RoomEntityRecord> RoomEntities => Set<RoomEntityRecord>();

    protected override void OnModelCreating(ModelBuilder modelBuilder)
    {
        modelBuilder.Entity<RoomRecord>(entity =>
        {
            entity.ToTable("Rooms");
            entity.HasKey(room => room.RoomId);
            entity.Property(room => room.RoomId).HasMaxLength(128);
            entity.Property(room => room.UpdatedAtUtc).IsRequired();
        });

        modelBuilder.Entity<RoomEntityRecord>(entity =>
        {
            entity.ToTable("RoomEntities");
            entity.HasKey(item => new { item.RoomId, item.Id });
            entity.Property(item => item.RoomId).HasMaxLength(128);
            entity.Property(item => item.Id).HasMaxLength(36);
            entity.Property(item => item.Name).HasMaxLength(64).IsRequired();
            entity.Property(item => item.Type).HasMaxLength(16).IsRequired();
            entity.Property(item => item.Color).HasMaxLength(7).IsRequired();
            entity.Property(item => item.MaterialMode).HasMaxLength(16).IsRequired();
            entity.Property(item => item.AnimationAxis).HasMaxLength(1).IsRequired();
            entity.Property(item => item.LastEditor).HasMaxLength(32);
            entity.HasOne<RoomRecord>()
                .WithMany()
                .HasForeignKey(item => item.RoomId)
                .OnDelete(DeleteBehavior.Cascade);
        });
    }
}

public sealed class RoomRecord
{
    public string RoomId { get; set; } = string.Empty;
    public DateTime UpdatedAtUtc { get; set; }
}

public sealed class RoomEntityRecord
{
    public string RoomId { get; set; } = string.Empty;
    public string Id { get; set; } = string.Empty;
    public string Name { get; set; } = string.Empty;
    public string Type { get; set; } = string.Empty;
    public string Color { get; set; } = string.Empty;
    public string MaterialMode { get; set; } = string.Empty;
    public double PositionX { get; set; }
    public double PositionY { get; set; }
    public double PositionZ { get; set; }
    public double RotationX { get; set; }
    public double RotationY { get; set; }
    public double RotationZ { get; set; }
    public double ScaleX { get; set; }
    public double ScaleY { get; set; }
    public double ScaleZ { get; set; }
    public bool AnimationEnabled { get; set; }
    public string AnimationAxis { get; set; } = string.Empty;
    public double AnimationSpeed { get; set; }
    public string? LastEditor { get; set; }
}
