using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Data;
using Laboratorio.Collaboration.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.Extensions.Logging.Abstractions;

namespace Laboratorio.Collaboration.Tests;

public sealed class RoomPersistenceServiceTests
{
    [Fact]
    public async Task FinalEntityStateSurvivesAServiceRestartWithAllProperties()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await service.StartAsync(CancellationToken.None);

        var original = CreateBox();
        await service.JoinAsync("connection-1", "Ana", 1, [original]);
        Assert.True(store.AcquireLock("connection-1", original.Id).Granted);
        var final = original with
        {
            Name = "Cubo editado",
            Color = "#ff0000",
            MaterialMode = "wireframe",
            Position = new Vector3Dto(2, 2.5, -2),
            Rotation = new Vector3Dto(0.3, 0.2, 0.1),
            Scale = new Vector3Dto(1.2, 1.1, 0.9),
            Animation = new AnimationDto(true, "z", 123)
        };
        var saved = await service.UpdateEntityAsync("connection-1", final, true);

        var restoredStore = new RoomStateStore();
        var restoredService = CreateService(factory, restoredStore);
        await restoredService.StartAsync(CancellationToken.None);
        var snapshot = await restoredService.JoinAsync("connection-2", "Bia", 1, [original]);

        Assert.Equal(saved, Assert.Single(snapshot.Entities));
        Assert.Equal("Ana", snapshot.Entities.Single().LastEditor);
        Assert.Equal(CollaborationProtocol.RoomId, snapshot.RoomId);
        Assert.Empty(snapshot.Locks);
        Assert.Single(snapshot.Participants);
    }

    [Fact]
    public async Task CreateUpdateAndDeletePersistOnlyCommittedStateAndDoNotReseedAnEmptyRoom()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var firstStore = new RoomStateStore();
        var firstService = CreateService(factory, firstStore);
        await firstService.StartAsync(CancellationToken.None);
        await firstService.JoinAsync("connection-1", "Ana", 1, []);

        var created = await firstService.CreateEntityAsync("connection-1", CreateBox());
        Assert.True(firstStore.AcquireLock("connection-1", created.Id).Granted);
        var inProgress = created with { Position = new Vector3Dto(3, 2, 1) };
        await firstService.UpdateEntityAsync("connection-1", inProgress, false);

        var restartedStore = new RoomStateStore();
        var restartedService = CreateService(factory, restartedStore);
        await restartedService.StartAsync(CancellationToken.None);
        var reloaded = await restartedService.JoinAsync("connection-2", "Bia", 1, []);
        Assert.Equal(created, Assert.Single(reloaded.Entities));

        Assert.True(restartedStore.AcquireLock("connection-2", created.Id).Granted);
        var final = inProgress with
        {
            Position = new Vector3Dto(3, 2, 1),
            Color = "#00ff00"
        };
        var updated = await restartedService.UpdateEntityAsync("connection-2", final, true);
        Assert.Equal("Bia", updated.LastEditor);
        Assert.True(await restartedService.DeleteEntityAsync("connection-2", created.Id));

        var afterDeleteStore = new RoomStateStore();
        var afterDeleteService = CreateService(factory, afterDeleteStore);
        await afterDeleteService.StartAsync(CancellationToken.None);
        var afterDelete = await afterDeleteService.JoinAsync(
            "connection-3",
            "Caio",
            1,
            [CreateBox()]);

        Assert.Empty(afterDelete.Entities);
    }

    [Fact]
    public async Task FailedFinalWriteRollsBackMemoryAndReportsFailure()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await service.StartAsync(CancellationToken.None);
        var original = CreateBox();
        await service.JoinAsync("connection-1", "Ana", 1, [original]);
        Assert.True(store.AcquireLock("connection-1", original.Id).Granted);

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync(
                """
                CREATE TRIGGER fail_room_entity_update
                BEFORE UPDATE ON RoomEntities
                BEGIN
                    SELECT RAISE(ABORT, 'forced persistence failure');
                END;
                """);
        }

        var failedUpdate = original with
        {
            Position = new Vector3Dto(2, 2, 2),
            Color = "#ff0000"
        };
        await Assert.ThrowsAsync<RoomPersistenceException>(
            () => service.UpdateEntityAsync("connection-1", failedUpdate, true));
        Assert.Equal(original, store.GetEntity(original.Id));

        var restartedStore = new RoomStateStore();
        var restartedService = CreateService(factory, restartedStore);
        await restartedService.StartAsync(CancellationToken.None);
        var restored = await restartedService.JoinAsync("connection-2", "Bia", 1, []);
        Assert.Equal(original, Assert.Single(restored.Entities));
    }

    [Fact]
    public async Task FailedCreateIsNotLeftInMemoryOrDatabase()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await service.StartAsync(CancellationToken.None);
        await service.JoinAsync("connection-1", "Ana", 1, []);

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync(
                """
                CREATE TRIGGER fail_room_entity_insert
                BEFORE INSERT ON RoomEntities
                BEGIN
                    SELECT RAISE(ABORT, 'forced persistence failure');
                END;
                """);
        }

        var entity = CreateBox();
        await Assert.ThrowsAsync<RoomPersistenceException>(
            () => service.CreateEntityAsync("connection-1", entity));
        Assert.Null(store.GetEntity(entity.Id));

        var restoredStore = new RoomStateStore();
        var restoredService = CreateService(factory, restoredStore);
        await restoredService.StartAsync(CancellationToken.None);
        var snapshot = await restoredService.JoinAsync("connection-2", "Bia", 1, [entity]);
        Assert.Empty(snapshot.Entities);
    }

    [Fact]
    public async Task FailedDeleteRestoresTheEntityAndKeepsTheEditLock()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await service.StartAsync(CancellationToken.None);
        var entity = CreateBox();
        await service.JoinAsync("connection-1", "Ana", 1, [entity]);
        Assert.True(store.AcquireLock("connection-1", entity.Id).Granted);

        await using (var context = factory.CreateDbContext())
        {
            await context.Database.ExecuteSqlRawAsync(
                """
                CREATE TRIGGER fail_room_entity_delete
                BEFORE DELETE ON RoomEntities
                BEGIN
                    SELECT RAISE(ABORT, 'forced persistence failure');
                END;
                """);
        }

        await Assert.ThrowsAsync<RoomPersistenceException>(
            () => service.DeleteEntityAsync("connection-1", entity.Id));
        Assert.Equal(entity, store.GetEntity(entity.Id));
        Assert.Equal("connection-1", store.GetLock(entity.Id)?.ParticipantId);

        var restoredStore = new RoomStateStore();
        var restoredService = CreateService(factory, restoredStore);
        await restoredService.StartAsync(CancellationToken.None);
        var restored = await restoredService.JoinAsync("connection-2", "Bia", 1, []);
        Assert.Equal(entity, Assert.Single(restored.Entities));
        Assert.Empty(restored.Locks);
    }

    private static EntityDto CreateBox() => new(
        Guid.NewGuid().ToString(),
        "Cubo",
        "box",
        "#6c8cff",
        "solid",
        new Vector3Dto(0, 0.75, 0),
        new Vector3Dto(0, 0, 0),
        new Vector3Dto(1, 1, 1),
        new AnimationDto(false, "y", 45));

    private static async Task<SqliteConnection> OpenDatabaseAsync()
    {
        var connection = new SqliteConnection("Data Source=:memory:");
        await connection.OpenAsync();
        return connection;
    }

    private static IDbContextFactory<RoomDbContext> CreateFactory(SqliteConnection connection)
    {
        var options = new DbContextOptionsBuilder<RoomDbContext>()
            .UseSqlite(connection)
            .Options;
        return new PooledDbContextFactory<RoomDbContext>(options);
    }

    private static RoomPersistenceService CreateService(
        IDbContextFactory<RoomDbContext> factory,
        RoomStateStore store) =>
        new(factory, store, NullLogger<RoomPersistenceService>.Instance);
}
