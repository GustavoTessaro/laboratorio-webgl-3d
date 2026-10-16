SET XACT_ABORT ON;

BEGIN TRY
    BEGIN TRANSACTION;

    DECLARE @RoomsObjectId int = OBJECT_ID(N'dbo.Rooms', N'U');
    DECLARE @RoomEntitiesObjectId int = OBJECT_ID(N'dbo.RoomEntities', N'U');

    IF @RoomsObjectId IS NULL
        THROW 51000, 'Required table dbo.Rooms does not exist.', 1;

    IF @RoomEntitiesObjectId IS NULL
        THROW 51001, 'Required table dbo.RoomEntities does not exist.', 1;

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.key_constraints AS kc
        INNER JOIN sys.index_columns AS ic
            ON ic.object_id = kc.parent_object_id
            AND ic.index_id = kc.unique_index_id
        INNER JOIN sys.columns AS c
            ON c.object_id = ic.object_id
            AND c.column_id = ic.column_id
        WHERE kc.parent_object_id = @RoomsObjectId
            AND kc.type = N'PK'
        GROUP BY kc.object_id
        HAVING COUNT(*) = 1
            AND MAX(CASE WHEN ic.key_ordinal = 1 AND c.name = N'RoomId' THEN 1 ELSE 0 END) = 1
    )
        THROW 51002, 'dbo.Rooms must have a primary key on (RoomId).', 1;

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.key_constraints AS kc
        INNER JOIN sys.index_columns AS ic
            ON ic.object_id = kc.parent_object_id
            AND ic.index_id = kc.unique_index_id
        INNER JOIN sys.columns AS c
            ON c.object_id = ic.object_id
            AND c.column_id = ic.column_id
        WHERE kc.parent_object_id = @RoomEntitiesObjectId
            AND kc.type = N'PK'
        GROUP BY kc.object_id
        HAVING COUNT(*) = 2
            AND MAX(CASE WHEN ic.key_ordinal = 1 AND c.name = N'RoomId' THEN 1 ELSE 0 END) = 1
            AND MAX(CASE WHEN ic.key_ordinal = 2 AND c.name = N'Id' THEN 1 ELSE 0 END) = 1
    )
        THROW 51003, 'dbo.RoomEntities must have a primary key on (RoomId, Id).', 1;

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.foreign_keys AS fk
        INNER JOIN sys.foreign_key_columns AS fkc
            ON fkc.constraint_object_id = fk.object_id
        INNER JOIN sys.columns AS child_column
            ON child_column.object_id = fkc.parent_object_id
            AND child_column.column_id = fkc.parent_column_id
        INNER JOIN sys.columns AS parent_column
            ON parent_column.object_id = fkc.referenced_object_id
            AND parent_column.column_id = fkc.referenced_column_id
        WHERE fk.parent_object_id = @RoomEntitiesObjectId
            AND fk.referenced_object_id = @RoomsObjectId
            AND fk.delete_referential_action = 1
        GROUP BY fk.object_id
        HAVING COUNT(*) = 1
            AND MAX(CASE
                WHEN child_column.name = N'RoomId' AND parent_column.name = N'RoomId'
                THEN 1 ELSE 0
            END) = 1
    )
        THROW 51004, 'dbo.RoomEntities must reference dbo.Rooms(RoomId) with ON DELETE CASCADE.', 1;

    IF OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U') IS NULL
    BEGIN
        CREATE TABLE dbo.__EFMigrationsHistory
        (
            MigrationId nvarchar(150) NOT NULL,
            ProductVersion nvarchar(32) NOT NULL,
            CONSTRAINT PK___EFMigrationsHistory PRIMARY KEY (MigrationId)
        );
    END;

    IF COL_LENGTH(N'dbo.__EFMigrationsHistory', N'MigrationId') IS NULL
        OR COL_LENGTH(N'dbo.__EFMigrationsHistory', N'ProductVersion') IS NULL
        THROW 51005, 'dbo.__EFMigrationsHistory exists but does not have the expected EF Core columns.', 1;

    IF NOT EXISTS
    (
        SELECT 1
        FROM sys.key_constraints AS kc
        INNER JOIN sys.index_columns AS ic
            ON ic.object_id = kc.parent_object_id
            AND ic.index_id = kc.unique_index_id
        INNER JOIN sys.columns AS c
            ON c.object_id = ic.object_id
            AND c.column_id = ic.column_id
        WHERE kc.parent_object_id = OBJECT_ID(N'dbo.__EFMigrationsHistory', N'U')
            AND kc.type = N'PK'
        GROUP BY kc.object_id
        HAVING COUNT(*) = 1
            AND MAX(CASE WHEN ic.key_ordinal = 1 AND c.name = N'MigrationId' THEN 1 ELSE 0 END) = 1
    )
        THROW 51006, 'dbo.__EFMigrationsHistory must have a primary key on (MigrationId).', 1;

    IF EXISTS
    (
        SELECT 1
        FROM dbo.__EFMigrationsHistory
        WHERE MigrationId = N'20261016104024_InitialRoomPersistence'
            AND ProductVersion <> N'10.0.9'
    )
        THROW 51007, 'The migration is already registered with a different EF Core version.', 1;

    IF NOT EXISTS
    (
        SELECT 1
        FROM dbo.__EFMigrationsHistory
        WHERE MigrationId = N'20261016104024_InitialRoomPersistence'
    )
    BEGIN
        INSERT INTO dbo.__EFMigrationsHistory (MigrationId, ProductVersion)
        VALUES (N'20261016104024_InitialRoomPersistence', N'10.0.9');
    END;

    COMMIT TRANSACTION;

    SELECT MigrationId, ProductVersion
    FROM dbo.__EFMigrationsHistory
    WHERE MigrationId = N'20261016104024_InitialRoomPersistence';
END TRY
BEGIN CATCH
    IF @@TRANCOUNT > 0
        ROLLBACK TRANSACTION;

    THROW;
END CATCH;
