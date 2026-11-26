using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Data;
using Laboratorio.Collaboration.Services;
using Microsoft.Data.Sqlite;
using Microsoft.EntityFrameworkCore;
using Microsoft.EntityFrameworkCore.Infrastructure;
using Microsoft.EntityFrameworkCore.Diagnostics;
using Microsoft.EntityFrameworkCore.Migrations;
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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [original]);
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
        var snapshot = await restoredService.JoinAsync("connection-2", "Bia", CollaborationProtocol.Version, [original]);

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
        await firstService.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, []);

        var created = await firstService.CreateEntityAsync("connection-1", CreateBox());
        Assert.True(firstStore.AcquireLock("connection-1", created.Id).Granted);
        var inProgress = created with { Position = new Vector3Dto(3, 2, 1) };
        await firstService.UpdateEntityAsync("connection-1", inProgress, false);

        var restartedStore = new RoomStateStore();
        var restartedService = CreateService(factory, restartedStore);
        await StartAndWaitAsync(restartedService);
        var reloaded = await restartedService.JoinAsync("connection-2", "Bia", CollaborationProtocol.Version, []);
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
            CollaborationProtocol.Version,
            [CreateBox()]);

        Assert.Empty(afterDelete.Entities);
    }

    [Fact]
    public async Task PreviewsAndUnchangedConfirmationsDoNotWriteOrEnterTheRoomSnapshot()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var store = new RoomStateStore();
        var service = CreateService(CreateFactory(connection, interceptor), store);
        await StartAndWaitAsync(service);
        await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        var created = await service.CreateEntityAsync("ana", CreateBox());
        var writes = interceptor.CommitCount;
        Assert.True(store.AcquireLock("ana", created.Id).Granted);

        var gesture = created with { Position = new Vector3Dto(3, 2, 1) };
        Assert.Equal(gesture, await service.UpdateEntityAsync("ana", gesture, false));
        Assert.Equal(created, Assert.Single((await service.JoinAsync("bia", "Bia", CollaborationProtocol.Version, [])).Entities));
        Assert.Equal(writes, interceptor.CommitCount);

        var discarded = new List<string>();
        Assert.True(store.ReleaseLock("ana", created.Id, discarded.Add));
        Assert.Equal(created.Id, Assert.Single(discarded));
        Assert.True(store.AcquireLock("bia", created.Id).Granted);
        await service.UpdateEntityAsync("bia", created, true);
        Assert.Equal(writes, interceptor.CommitCount);

        await service.UpdateEntityAsync("bia", gesture, false);
        var final = await service.UpdateEntityAsync("bia", gesture, true);
        Assert.Equal("Bia", final.LastEditor);
        Assert.Equal(writes + 1, interceptor.CommitCount);
        Assert.Equal(final, Assert.Single(store.GetSnapshot().Entities));
        Assert.Equal(final, await service.UpdateEntityAsync("bia", gesture, true));
        Assert.Equal(writes + 1, interceptor.CommitCount);
        discarded.Clear();
        store.Leave("bia", discarded.Add);
        Assert.Empty(discarded);
        Assert.Equal(final, store.GetEntity(created.Id));
    }

    [Fact]
    public async Task GeometryMigrationPreservesLegacyRowsAndPersistsOnlyConfirmedParameterChanges()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var legacy = CreateBox();
        await using (var database = await factory.CreateDbContextAsync())
        {
            await database.GetService<IMigrator>().MigrateAsync("20261016104024_InitialRoomPersistence");
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""INSERT INTO Rooms (RoomId, UpdatedAtUtc) VALUES ({CollaborationProtocol.RoomId}, {DateTime.UtcNow})""");
            await database.Database.ExecuteSqlInterpolatedAsync($"""
                INSERT INTO RoomEntities (
                    RoomId, Id, Name, Type, Color, MaterialMode,
                    PositionX, PositionY, PositionZ, RotationX, RotationY, RotationZ, ScaleX, ScaleY, ScaleZ,
                    AnimationEnabled, AnimationAxis, AnimationSpeed)
                VALUES (
                    {CollaborationProtocol.RoomId}, {legacy.Id}, {legacy.Name}, {legacy.Type}, {legacy.Color}, {legacy.MaterialMode},
                    {legacy.Position.X}, {legacy.Position.Y}, {legacy.Position.Z},
                    {legacy.Rotation.X}, {legacy.Rotation.Y}, {legacy.Rotation.Z},
                    {legacy.Scale.X}, {legacy.Scale.Y}, {legacy.Scale.Z},
                    {legacy.Animation.Enabled}, {legacy.Animation.Axis}, {legacy.Animation.Speed})
                """);
        }

        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        Assert.Equal(legacy, Assert.Single(original.Entities));
        var writes = interceptor.CommitCount;
        Assert.True(store.AcquireLock("ana", legacy.Id).Granted);

        var knot = legacy with
        {
            Type = "torusKnot",
            Position = new Vector3Dto(0, 4, 0),
            GeometryParameters = new GeometryParametersDto { ["p"] = 5, ["radius"] = 0.9, ["q"] = 3 }
        };
        var preview = await service.UpdateEntityAsync("ana", knot, false);
        Assert.Equal(knot.Type, preview.Type);
        Assert.Equal(legacy, Assert.Single(store.GetSnapshot().Entities));
        Assert.Equal(writes, interceptor.CommitCount);

        var final = await service.UpdateEntityAsync("ana", knot, true);
        Assert.Equal(new GeometryParametersDto { ["p"] = 5, ["radius"] = 0.9 }, final.GeometryParameters);
        Assert.Equal(writes + 1, interceptor.CommitCount);
        var equivalent = knot with
        {
            GeometryParameters = new GeometryParametersDto { ["radius"] = 0.9, ["p"] = 5 }
        };
        Assert.Equal(final, await service.UpdateEntityAsync("ana", equivalent, true));
        Assert.Equal(writes + 1, interceptor.CommitCount);

        var restarted = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restarted);
        var reloaded = await restarted.JoinAsync("bia", "Bia", CollaborationProtocol.Version, []);
        Assert.Equal(final, Assert.Single(reloaded.Entities));
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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [original]);
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
        var restored = await restartedService.JoinAsync("connection-2", "Bia", CollaborationProtocol.Version, []);
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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, []);

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
        var snapshot = await restoredService.JoinAsync("connection-2", "Bia", CollaborationProtocol.Version, [entity]);
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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
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
        var restored = await restoredService.JoinAsync("connection-2", "Bia", CollaborationProtocol.Version, []);
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
        await initialService.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [persistedEntity]);

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
            CollaborationProtocol.Version,
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
            service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [initialEntity]));

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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, []);

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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [original]);
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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
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
        await service.JoinAsync("connection-1", "Ana", CollaborationProtocol.Version, []);
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
        private int _commitCount;
        public int CommitCount => Volatile.Read(ref _commitCount);

        public void ThrowAfterNextCommit() => Interlocked.Exchange(ref _shouldThrow, 1);

        public override ValueTask<int> SavedChangesAsync(
            SaveChangesCompletedEventData eventData,
            int result,
            CancellationToken cancellationToken = default)
        {
            Interlocked.Increment(ref _commitCount);
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
