BEGIN TRANSACTION;
IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261127011417_AddEntityTrajectory'
)
BEGIN
    ALTER TABLE [RoomEntities] ADD [TrajectoryJson] nvarchar(2048) NULL;
END;

IF NOT EXISTS (
    SELECT * FROM [__EFMigrationsHistory]
    WHERE [MigrationId] = N'20261127011417_AddEntityTrajectory'
)
BEGIN
    INSERT INTO [__EFMigrationsHistory] ([MigrationId], [ProductVersion])
    VALUES (N'20261127011417_AddEntityTrajectory', N'10.0.9');
END;

COMMIT;
GO
