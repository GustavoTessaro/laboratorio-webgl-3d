using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Data;
using Laboratorio.Collaboration.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
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
        await StartAndWaitAsync(service);

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
        await StartAndWaitAsync(restoredService);
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
        await StartAndWaitAsync(firstService);
        await firstService.JoinAsync("connection-1", "Ana", 1, []);

        var created = await firstService.CreateEntityAsync("connection-1", CreateBox());
        Assert.True(firstStore.AcquireLock("connection-1", created.Id).Granted);
        var inProgress = created with { Position = new Vector3Dto(3, 2, 1) };
        await firstService.UpdateEntityAsync("connection-1", inProgress, false);

        var restartedStore = new RoomStateStore();
        var restartedService = CreateService(factory, restartedStore);
        await StartAndWaitAsync(restartedService);
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
        await StartAndWaitAsync(afterDeleteService);
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
        await StartAndWaitAsync(service);
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
        await StartAndWaitAsync(restartedService);
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
        await StartAndWaitAsync(service);
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
        await StartAndWaitAsync(restoredService);
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
        await StartAndWaitAsync(service);
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
        await StartAndWaitAsync(restoredService);
        var restored = await restoredService.JoinAsync("connection-2", "Bia", 1, []);
        Assert.Equal(entity, Assert.Single(restored.Entities));
        Assert.Empty(restored.Locks);
    }

    [Fact]
    public async Task TransientStartupFailureRetriesAndLoadsPersistedSceneBeforeJoining()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var initialStore = new RoomStateStore();
        var initialService = CreateService(factory, initialStore);
        await StartAndWaitAsync(initialService);
        var persistedEntity = CreateBox();
        await initialService.JoinAsync("connection-1", "Ana", 1, [persistedEntity]);

        var retryingFactory = new TransientFailureDbContextFactory(factory);
        var recoveredStore = new RoomStateStore();
        var recoveredService = CreateService(
            retryingFactory,
            recoveredStore,
            recoveryInterval: TimeSpan.FromMilliseconds(5));
        await StartAndWaitAsync(recoveredService);

        var suppliedByClient = CreateBox();
        var snapshot = await recoveredService.JoinAsync(
            "connection-2",
            "Bia",
            1,
            [suppliedByClient]);

        Assert.Equal(2, retryingFactory.CreateAttempts);
        Assert.Equal(persistedEntity.Id, Assert.Single(snapshot.Entities).Id);
        Assert.True(recoveredService.IsReady);
    }

    [Fact]
    public async Task JoinBeforePersistenceIsReadyDoesNotInitializeOrSeedTheRoom()
    {
        await using var connection = await OpenDatabaseAsync();
        var store = new RoomStateStore();
        var service = CreateService(CreateFactory(connection), store);
        var initialEntity = CreateBox();

        await Assert.ThrowsAsync<RoomPersistenceException>(() =>
            service.JoinAsync("connection-1", "Ana", 1, [initialEntity]));

        Assert.False(service.IsReady);
        Assert.False(store.IsInitialized);
        Assert.Null(store.GetEntity(initialEntity.Id));
    }

    [Fact]
    public async Task ConfirmedCreateWithLostAcknowledgementIsTreatedAsSuccessful()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        await service.JoinAsync("connection-1", "Ana", 1, []);

        var entity = CreateBox();
        interceptor.ThrowAfterNextCommit();
        var created = await service.CreateEntityAsync("connection-1", entity);

        Assert.Equal(entity.Id, created.Id);
        Assert.Equal(created, store.GetEntity(entity.Id));
        await using var context = factory.CreateDbContext();
        var stored = await context.RoomEntities.SingleAsync(item => item.Id == entity.Id);
        Assert.Equal(created.Name, stored.Name);
        Assert.Equal(created.LastEditor, stored.LastEditor);
    }

    [Fact]
    public async Task ConfirmedUpdateWithLostAcknowledgementIsTreatedAsSuccessful()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = CreateBox();
        await service.JoinAsync("connection-1", "Ana", 1, [original]);
        Assert.True(store.AcquireLock("connection-1", original.Id).Granted);
        var updatedEntity = original with
        {
            Name = "Cubo confirmado",
            Color = "#ff0000",
            Position = new Vector3Dto(2, 3, 4)
        };

        interceptor.ThrowAfterNextCommit();
        var updated = await service.UpdateEntityAsync("connection-1", updatedEntity, true);

        Assert.Equal(updated, store.GetEntity(original.Id));
        await using var context = factory.CreateDbContext();
        var stored = await context.RoomEntities.SingleAsync(item => item.Id == original.Id);
        Assert.Equal(updated.Name, stored.Name);
        Assert.Equal(updated.Color, stored.Color);
        Assert.Equal(updated.Position.X, stored.PositionX);
        Assert.Equal(updated.LastEditor, stored.LastEditor);
    }

    [Fact]
    public async Task ConfirmedDeleteWithLostAcknowledgementIsTreatedAsSuccessful()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var entity = CreateBox();
        await service.JoinAsync("connection-1", "Ana", 1, [entity]);
        Assert.True(store.AcquireLock("connection-1", entity.Id).Granted);

        interceptor.ThrowAfterNextCommit();
        Assert.True(await service.DeleteEntityAsync("connection-1", entity.Id));

        Assert.Null(store.GetEntity(entity.Id));
        await using var context = factory.CreateDbContext();
        Assert.False(await context.RoomEntities.AnyAsync(item => item.Id == entity.Id));
    }

    [Fact]
    public async Task FailedVerificationKeepsRoomUnavailableUntilDatabaseReconciliation()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var innerFactory = CreateFactory(connection, interceptor);
        var factory = new FailOnAsyncCreateAttemptDbContextFactory(innerFactory, 4);
        var store = new RoomStateStore();
        var service = CreateService(
            factory,
            store,
            recoveryInterval: TimeSpan.FromMilliseconds(5));
        await StartAndWaitAsync(service);
        await service.JoinAsync("connection-1", "Ana", 1, []);
        var entity = CreateBox();
        interceptor.ThrowAfterNextCommit();

        var exception = await Assert.ThrowsAsync<RoomPersistenceException>(
            () => service.CreateEntityAsync("connection-1", entity));

        Assert.True(exception.RequiresReconciliation);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!service.IsReady)
        {
            await Task.Delay(5, timeout.Token);
        }

        Assert.Equal(entity.Id, store.GetEntity(entity.Id)?.Id);
        await using var context = innerFactory.CreateDbContext();
        Assert.True(await context.RoomEntities.AnyAsync(item => item.Id == entity.Id));
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

    private static IDbContextFactory<RoomDbContext> CreateFactory(
        SqliteConnection connection,
        SaveChangesInterceptor? interceptor = null)
    {
        var optionsBuilder = new DbContextOptionsBuilder<RoomDbContext>().UseSqlite(connection);
        if (interceptor is not null)
        {
            optionsBuilder.AddInterceptors(interceptor);
        }

        var options = optionsBuilder.Options;
        return new PooledDbContextFactory<RoomDbContext>(options);
    }

    private static RoomPersistenceService CreateService(
        IDbContextFactory<RoomDbContext> factory,
        RoomStateStore store,
        TimeSpan? recoveryInterval = null) =>
        new(
            factory,
            store,
            NullLogger<RoomPersistenceService>.Instance,
            recoveryInterval: recoveryInterval);

    private static async Task StartAndWaitAsync(RoomPersistenceService service)
    {
        await service.StartAsync(CancellationToken.None);
        using var timeout = new CancellationTokenSource(TimeSpan.FromSeconds(5));
        while (!service.IsReady)
        {
            await Task.Delay(5, timeout.Token);
        }
    }

    private sealed class TransientFailureDbContextFactory(
        IDbContextFactory<RoomDbContext> innerFactory) : IDbContextFactory<RoomDbContext>
    {
        private int _createAttempts;

        public int CreateAttempts => Volatile.Read(ref _createAttempts);

        public RoomDbContext CreateDbContext() => innerFactory.CreateDbContext();

        public async Task<RoomDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _createAttempts) == 1)
            {
                throw new TimeoutException("Simulated temporary database unavailability.");
            }

            return await innerFactory.CreateDbContextAsync(cancellationToken);
        }
    }

    private sealed class ThrowAfterCommitInterceptor : SaveChangesInterceptor
    {
        private int _shouldThrow;

        public void ThrowAfterNextCommit() => Interlocked.Exchange(ref _shouldThrow, 1);

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData,
            int result,
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Exchange(ref _shouldThrow, 0) == 1)
            {
                throw new TimeoutException("Simulated lost acknowledgement after database commit.");
            }

            return ValueTask.FromResult(result);
        }
    }

    private sealed class FailOnAsyncCreateAttemptDbContextFactory(
        IDbContextFactory<RoomDbContext> innerFactory,
        int failureAttempt) : IDbContextFactory<RoomDbContext>
    {
        private int _attempts;

        public RoomDbContext CreateDbContext() => innerFactory.CreateDbContext();

        public async Task<RoomDbContext> CreateDbContextAsync(
            CancellationToken cancellationToken = default)
        {
            if (Interlocked.Increment(ref _attempts) == failureAttempt)
            {
                throw new TimeoutException("Simulated temporary verification-query failure.");
            }

            return await innerFactory.CreateDbContextAsync(cancellationToken);
        }
    }
}
