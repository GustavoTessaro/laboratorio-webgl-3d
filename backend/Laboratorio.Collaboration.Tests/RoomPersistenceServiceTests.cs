using System.Text.Json;
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
        await SeedLegacyEntityAsync(factory, legacy, "20261016104024_InitialRoomPersistence");

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
    public async Task MaterialMigrationPreservesV2GeometryAndOnlyWritesConfirmedAppearance()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var legacy = CreateBox() with
        {
            Type = "plane",
            GeometryParameters = new GeometryParametersDto { ["width"] = 3 }
        };
        await SeedLegacyEntityAsync(factory, legacy, "20261126233514_AddGeometryParameters");

        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        Assert.Equal(legacy, Assert.Single(original.Entities));
        Assert.True(store.AcquireLock("ana", legacy.Id).Granted);
        var writes = interceptor.CommitCount;
        var candidate = legacy with
        {
            MaterialSettings = new MaterialSettingsDto(
                Kind: "phong", Opacity: 0.5, Transparent: true, Side: "double",
                Specular: "#FFEEDD", Emissive: "#123456", Shininess: 70,
                EmissiveIntensity: 2, TextureId: "wood", RepeatU: 3, OffsetV: 0.35, TextureRotation: 90)
        };
        await service.UpdateEntityAsync("ana", candidate, false);
        Assert.Equal(legacy, store.GetEntity(legacy.Id));
        Assert.Equal(writes, interceptor.CommitCount);
        var final = await service.UpdateEntityAsync("ana", candidate, true);
        Assert.Equal("#ffeedd", final.MaterialSettings!.Specular);
        Assert.Equal(writes + 1, interceptor.CommitCount);
        Assert.Equal(final, await service.UpdateEntityAsync("ana", candidate, true));
        Assert.Equal(writes + 1, interceptor.CommitCount);

        var restarted = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restarted);
        var recovered = await restarted.JoinAsync("bia", "Bia", CollaborationProtocol.Version, []);
        Assert.Equal(final, Assert.Single(recovered.Entities));
    }

    [Fact]
    public async Task RoomLightingMigratesLegacyRoomsAndMergesConfirmedFieldsWithoutRedundantWrites()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var legacy = CreateBox();
        await SeedLegacyEntityAsync(factory, legacy, "20261126235231_AddMaterialSettings");
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        await service.JoinAsync("bia", "Bia", CollaborationProtocol.Version, []);
        Assert.Equal(legacy, Assert.Single(original.Entities));
        Assert.Equal(0, original.Lighting.Revision);
        Assert.Equal(3, original.Lighting.Settings.GetProperty("directional").GetProperty("intensity").GetDouble());
        var writes = interceptor.CommitCount;

        var concurrent = await Task.WhenAll(
            service.UpdateLightingAsync("ana", "directional", JsonSerializer.SerializeToElement(new { intensity = 4 })),
            service.UpdateLightingAsync("bia", "directional", JsonSerializer.SerializeToElement(new { color = "#AABBCC" })));
        Assert.All(concurrent, result => Assert.True(result.Changed));
        var state = store.GetLighting();
        Assert.Equal(2, state.Revision);
        Assert.Equal(4, state.Settings.GetProperty("directional").GetProperty("intensity").GetDouble());
        Assert.Equal("#aabbcc", state.Settings.GetProperty("directional").GetProperty("color").GetString());
        Assert.Equal(writes + 2, interceptor.CommitCount);
        var duplicate = await service.UpdateLightingAsync("ana", "directional",
            JsonSerializer.SerializeToElement(new { intensity = 4 }));
        Assert.False(duplicate.Changed);
        Assert.Equal(writes + 2, interceptor.CommitCount);

        await service.UpdateLightingAsync("bia", "directional", JsonSerializer.SerializeToElement(new { intensity = 5 }));
        interceptor.ThrowAfterNextCommit();
        var floor = await service.UpdateLightingAsync("ana", "environment",
            JsonSerializer.SerializeToElement(new { floorVisible = true, gridVisible = false }));
        Assert.True(floor.Changed);
        Assert.Equal(4, floor.State.Revision);
        Assert.Equal(writes + 4, interceptor.CommitCount);

        var restarted = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restarted);
        var reopened = await restarted.JoinAsync("caio", "Caio", CollaborationProtocol.Version, []);
        Assert.Equal(4, reopened.Lighting.Revision);
        Assert.True(JsonElement.DeepEquals(floor.State.Settings, reopened.Lighting.Settings));
        Assert.Equal(legacy, Assert.Single(reopened.Entities));
        var lightReset = await restarted.UpdateLightingAsync("caio", "directional", null);
        Assert.Equal(3, lightReset.State.Settings.GetProperty("directional").GetProperty("intensity").GetDouble());
        Assert.True(lightReset.State.Settings.GetProperty("environment").GetProperty("floorVisible").GetBoolean());
        var reset = await restarted.UpdateLightingAsync("caio", null, null);
        Assert.True(JsonElement.DeepEquals(original.Lighting.Settings, reset.State.Settings));
        Assert.False((await restarted.UpdateLightingAsync("caio", null, null)).Changed);
        Assert.Equal(writes + 6, interceptor.CommitCount);
    }

    [Fact]
    public async Task RoomLightingRejectsNonParticipantsAndInvalidPatchesBeforeWriting()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var store = new RoomStateStore();
        var service = CreateService(CreateFactory(connection, interceptor), store);
        await StartAndWaitAsync(service);
        await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        var writes = interceptor.CommitCount;
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.UpdateLightingAsync("guest", null, null));
        foreach (var (group, invalid) in new[]
        {
            ("ambient", """{"x":1}"""),
            ("ambient", """{"enabled":1}"""),
            ("hemisphere", """{"groundColor":"red"}"""),
            ("spot", """{"angle":120}"""),
            ("spot", """{"penumbra":1.1}"""),
            ("point", """{"distance":0.1}"""),
            ("directional", """{"x":0,"y":0,"z":0}"""),
            ("environment", """{"shadowQuality":"ultra"}"""),
            ("environment", """{"floorVisible":true,"floorVisible":false}"""),
        })
        {
            using var json = JsonDocument.Parse(invalid);
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                service.UpdateLightingAsync("ana", group, json.RootElement));
        }
        Assert.Equal(writes, interceptor.CommitCount);
        Assert.Equal(0, store.GetLighting().Revision);
    }

    [Fact]
    public async Task ParticlesMigrationStartsEmptyAndRecoversMergedConfigurationWithNoRedundantWrites()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var legacy = CreateBox();
        await SeedLegacyEntityAsync(factory, legacy, "20261127000611_AddRoomLighting");
        const string lighting = """{"Revision":7,"Settings":{"directional":{"intensity":4}}}""";
        await using (var database = await factory.CreateDbContextAsync())
        {
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""UPDATE Rooms SET LightingJson = {lighting} WHERE RoomId = {CollaborationProtocol.RoomId}""");
        }
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        await service.JoinAsync("bia", "Bia", CollaborationProtocol.Version, []);
        Assert.Equal(legacy, Assert.Single(original.Entities));
        Assert.Equal(7, original.Lighting.Revision);
        Assert.Empty(original.Particles.Effects.EnumerateObject());
        var writes = interceptor.CommitCount;
        var id = Guid.NewGuid().ToString();
        var add = new ParticleCommandDto("add", id, JsonSerializer.SerializeToElement(new { type = "fountain", count = 5000 }));
        var created = await service.UpdateParticlesAsync("ana", add);
        Assert.True(created.Changed);
        Assert.Equal(5000, created.State.Effects.GetProperty(id).GetProperty("count").GetInt32());
        Assert.False((await service.UpdateParticlesAsync("ana", add)).Changed);

        var results = await Task.WhenAll(
            service.UpdateParticlesAsync("ana", new("patch", id, JsonSerializer.SerializeToElement(new { gravity = 12.5 }))),
            service.UpdateParticlesAsync("bia", new("patch", id, JsonSerializer.SerializeToElement(new { color = "#AABBCC" }))));
        Assert.All(results, result => Assert.True(result.Changed));
        Assert.Equal(writes + 3, interceptor.CommitCount);
        var current = store.GetParticles();
        var effect = current.Effects.GetProperty(id);
        Assert.Equal(12.5, effect.GetProperty("gravity").GetDouble());
        Assert.Equal("#aabbcc", effect.GetProperty("color").GetString());
        Assert.False((await service.UpdateParticlesAsync("ana", new("patch", id,
            JsonSerializer.SerializeToElement(new { gravity = 12.5 })))).Changed);
        Assert.Equal(writes + 3, interceptor.CommitCount);
        interceptor.ThrowAfterNextCommit();
        var pausedEffect = await service.UpdateParticlesAsync("ana", new("patch", id,
            JsonSerializer.SerializeToElement(new { enabled = false })));
        Assert.Equal(4, pausedEffect.State.Revision);

        var restarted = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restarted);
        var reopened = await restarted.JoinAsync("caio", "Caio", CollaborationProtocol.Version, []);
        Assert.Equal(7, reopened.Lighting.Revision);
        Assert.Equal(legacy, Assert.Single(reopened.Entities));
        Assert.Equal(pausedEffect.State.Revision, reopened.Particles.Revision);
        Assert.True(JsonElement.DeepEquals(pausedEffect.State.Effects, reopened.Particles.Effects));
        Assert.True((await restarted.UpdateParticlesAsync("caio", new("remove", id))).Changed);
        Assert.False((await restarted.UpdateParticlesAsync("caio", new("remove", id))).Changed);
        Assert.Equal(writes + 5, interceptor.CommitCount);
    }

    [Fact]
    public async Task ParticlesRejectsInvalidCommandsAndEnforcesRoomBudgetEvenWhenDisabled()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var store = new RoomStateStore();
        var service = CreateService(CreateFactory(connection, interceptor), store);
        await StartAndWaitAsync(service);
        await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.UpdateParticlesAsync("guest", new("remove", Guid.NewGuid().ToString())));
        var ids = Enumerable.Range(0, 5).Select(_ => Guid.NewGuid().ToString()).ToArray();
        var types = new[] { "fountain", "rain", "snow", "galaxy" };
        var amounts = new[] { 5000, 5000, 1999, 1 };
        for (var index = 0; index < types.Length; index++)
        {
            await service.UpdateParticlesAsync("ana", new("add", ids[index], JsonSerializer.SerializeToElement(
                new { type = types[index], count = amounts[index], enabled = index != 1 })));
        }
        var writes = interceptor.CommitCount;
        foreach (var invalid in new[]
        {
            """{"count":5001}""", """{"count":1.5}""", """{"wind":3}""", """{"y":-1}""", """{"seed":-1}""",
            """{"type":"unknown"}""", """{"color":"red"}""", """{"opacity":1.5}""",
            """{"count":1,"count":2}"""
        })
        {
            using var json = JsonDocument.Parse(invalid);
            await Assert.ThrowsAsync<InvalidOperationException>(() =>
                service.UpdateParticlesAsync("ana", new("patch", ids[0], json.RootElement)));
        }
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.UpdateParticlesAsync(
            "ana", new("add", ids[4], JsonSerializer.SerializeToElement(new { type = "snow", count = 1 }))));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.UpdateParticlesAsync(
            "ana", new("patch", ids[3], JsonSerializer.SerializeToElement(new { count = 2 }))));
        Assert.Equal(writes, interceptor.CommitCount);
        Assert.Equal(4, store.GetParticles().Revision);
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

    [Fact]
    public async Task TrajectoryMigratesLegacyEntityAndPersistsOnlyConfirmedChanges()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var legacy = CreateBox();
        await SeedLegacyEntityAsync(factory, legacy, "20261127004156_AddRoomParticles");
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var joined = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        Assert.Equal(legacy, Assert.Single(joined.Entities));
        Assert.True(store.AcquireLock("ana", legacy.Id).Granted);

        var settings = new TrajectoryDto(Enabled: true, Type: "catmull",
            Points: [new(-1, 0, 0), new(0, 1, 0), new(1, 0, 0)]);
        var edited = legacy with { Position = new Vector3Dto(0, 3, 0), Trajectory = settings };
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.UpdateEntityAsync("ana", edited, false));
        await service.UpdateEntityAsync("ana", edited with { Trajectory = null }, false);
        await using (var context = factory.CreateDbContext())
            Assert.Null((await context.RoomEntities.SingleAsync()).TrajectoryJson);
        var confirmed = await service.UpdateEntityAsync("ana", edited, true);
        Assert.Equal(settings, confirmed.Trajectory);

        await using (var context = factory.CreateDbContext())
            await context.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER prevent_redundant_trajectory_write
                BEFORE UPDATE ON RoomEntities
                BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;
                """);
        Assert.Equal(confirmed, await service.UpdateEntityAsync("ana", edited, true));
        var restarted = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restarted);
        Assert.Equal(confirmed, Assert.Single((await restarted.JoinAsync("bia", "Bia",
            CollaborationProtocol.Version, [])).Entities));
    }

    [Fact]
    public async Task ModelingDescriptorsRoundTripThroughExistingColumnWithoutPreviewWrites()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var legacy = CreateBox();
        await SeedLegacyEntityAsync(factory, legacy, "20261127011417_AddEntityTrajectory");
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var joined = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, []);
        Assert.Equal(legacy, Assert.Single(joined.Entities));
        Assert.True(store.AcquireLock("ana", legacy.Id).Granted);
        var parameters = new GeometryParametersDto
        {
            ["pointCount"] = 3, ["x0"] = -10000, ["y0"] = -10000,
            ["x1"] = 10000, ["y1"] = -10000, ["x2"] = 0, ["y2"] = 10000,
            ["bevelEnabled"] = 1, ["bevelSize"] = 0.05, ["depth"] = 0.7
        };
        var edited = legacy with
        {
            Type = "extrude", Position = new Vector3Dto(0, 4, 0), GeometryParameters = parameters
        };
        await service.UpdateEntityAsync("ana", edited, false);
        await using (var context = factory.CreateDbContext())
        {
            var stored = await context.RoomEntities.SingleAsync();
            Assert.Null(stored.GeometryParametersJson);
            Assert.Equal("box", stored.Type);
        }
        var confirmed = await service.UpdateEntityAsync("ana", edited, true);
        Assert.Equal(parameters, confirmed.GeometryParameters);
        await using (var context = factory.CreateDbContext())
        {
            var stored = await context.RoomEntities.SingleAsync();
            Assert.InRange(stored.GeometryParametersJson!.Length, 1, 1024);
            await context.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER prevent_redundant_modeling_write
                BEFORE UPDATE ON RoomEntities
                BEGIN SELECT RAISE(ABORT, 'unexpected write'); END;
                """);
        }
        Assert.Equal(confirmed, await service.UpdateEntityAsync("ana", edited, true));
        var restored = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restored);
        Assert.Equal(confirmed, Assert.Single((await restored.JoinAsync("bia", "Bia",
            CollaborationProtocol.Version, [])).Entities));
    }

    [Fact]
    public async Task EnvironmentCatalogAppliesEachPresetAndEnforcesActiveLocksAndCapacity()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        var original = CreateBox();
        await SeedLegacyEntityAsync(factory, original, "20261127011417_AddEntityTrajectory");
        await StartAndWaitAsync(service);
        Assert.Equal(original, Assert.Single((await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, [])).Entities));
        await service.JoinAsync("bia", "Bia", CollaborationProtocol.Version, []);
        var replace = new EnvironmentCommandDto("geometry-lab", "replace", Guid.NewGuid(), 1);
        Assert.True(store.AcquireLock("bia", original.Id).Granted);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ApplyEnvironmentAsync("ana", replace));
        Assert.Equal(original, store.GetEntity(original.Id));
        Assert.True(store.ReleaseLock("bia", original.Id));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ApplyEnvironmentAsync("outsider", replace));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ApplyEnvironmentAsync("ana", replace with { CatalogVersion = 99 }));
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ApplyEnvironmentAsync("ana",
            replace with { EnvironmentId = "empty-scene", Mode = "add" }));
        foreach (var (id, count) in new (string, int)[]
        {
            ("geometry-lab", 15), ("material-gallery", 13), ("lighting-studio", 3),
            ("motion-lab", 5), ("particle-fountain", 2), ("modeling-workshop", 10), ("empty-scene", 0)
        })
        {
            var change = await service.ApplyEnvironmentAsync("ana", replace with { EnvironmentId = id, OperationId = Guid.NewGuid() });
            Assert.Equal(count, change!.Entities.Length);
            Assert.Equal(count, store.GetSnapshot().Entities.Count);
            Assert.InRange(JsonSerializer.SerializeToUtf8Bytes(change).Length, 1, 256 * 1024);
        }
        for (var i = 0; i < 6; i++)
            await service.ApplyEnvironmentAsync("ana", replace with { Mode = "add", OperationId = Guid.NewGuid() });
        await Assert.ThrowsAsync<InvalidOperationException>(() =>
            service.ApplyEnvironmentAsync("ana", replace with { Mode = "add", OperationId = Guid.NewGuid() }));
        Assert.Equal(90, store.GetSnapshot().Entities.Count);
    }

    [Fact]
    public async Task EnvironmentReceiptDeduplicatesAfterAmbiguousAckAndRestart()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = CreateBox();
        var initial = await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, [original]);
        var command = new EnvironmentCommandDto("particle-fountain", "add", Guid.NewGuid(), 1);
        var commits = interceptor.CommitCount;
        interceptor.ThrowAfterNextCommit();
        var batch = await service.ApplyEnvironmentAsync("ana", command);
        Assert.NotNull(batch);
        Assert.Equal(initial.Lighting, batch.Lighting);
        Assert.Equal(3, store.GetSnapshot().Entities.Count);
        Assert.Single(batch.Particles.Effects.EnumerateObject());
        var repeats = await Task.WhenAll(service.ApplyEnvironmentAsync("ana", command), service.ApplyEnvironmentAsync("ana", command));
        Assert.All(repeats, Assert.Null);
        Assert.Equal(commits + 1, interceptor.CommitCount);
        var restarted = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restarted);
        var restored = await restarted.JoinAsync("bia", "Bia", CollaborationProtocol.Version, []);
        Assert.Equal(3, restored.Entities.Count);
        Assert.True(JsonElement.DeepEquals(batch.Particles.Effects, restored.Particles.Effects));
        Assert.Null(await restarted.ApplyEnvironmentAsync("bia", command));
        await Assert.ThrowsAsync<InvalidOperationException>(() => restarted.ApplyEnvironmentAsync("bia", command with { Mode = "replace" }));
        Assert.Equal(commits + 1, interceptor.CommitCount);
    }

    [Fact]
    public async Task EnvironmentWriteRejectsParticleOverflowAndRollsBackWholeReplacement()
    {
        await using var connection = await OpenDatabaseAsync();
        var factory = CreateFactory(connection);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var original = CreateBox();
        await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, [original]);
        for (var i = 0; i < 4; i++)
            await service.UpdateParticlesAsync("ana", new ParticleCommandDto("add", Guid.NewGuid().ToString(),
                JsonSerializer.SerializeToElement(new { type = "fountain" })));
        var fountain = new EnvironmentCommandDto("particle-fountain", "add", Guid.NewGuid(), 1);
        await Assert.ThrowsAsync<InvalidOperationException>(() => service.ApplyEnvironmentAsync("ana", fountain));
        Assert.Single(store.GetSnapshot().Entities);

        await using (var db = factory.CreateDbContext())
            await db.Database.ExecuteSqlRawAsync("""
                CREATE TRIGGER reject_environment_receipt BEFORE INSERT ON EnvironmentReceipts
                BEGIN SELECT RAISE(ABORT, 'simulated failed batch'); END;
                """);
        await Assert.ThrowsAsync<RoomPersistenceException>(() => service.ApplyEnvironmentAsync("ana",
            fountain with { Mode = "replace" }));
        Assert.Equal(original, Assert.Single(store.GetSnapshot().Entities));
        Assert.Equal(4, store.GetParticles().Effects.EnumerateObject().Count());
        await using var verification = factory.CreateDbContext();
        Assert.Equal(original.Id, (await verification.RoomEntities.SingleAsync()).Id);
        Assert.Empty(verification.EnvironmentReceipts);
    }

    [Fact]
    public async Task ShaderUsesExistingMaterialColumnAndDoesNotWritePreviewOrRedundantConfirmation()
    {
        await using var connection = await OpenDatabaseAsync();
        var interceptor = new ThrowAfterCommitInterceptor();
        var factory = CreateFactory(connection, interceptor);
        var store = new RoomStateStore();
        var service = CreateService(factory, store);
        await StartAndWaitAsync(service);
        var legacy = CreateBox() with { Position = new(0, 3, 0) };
        Assert.Equal(legacy, Assert.Single((await service.JoinAsync("ana", "Ana", CollaborationProtocol.Version, [legacy])).Entities));
        Assert.True(store.AcquireLock("ana", legacy.Id).Granted);
        var edited = legacy with { MaterialSettings = new(Kind: "shader", TextureId: "wood", Roughness: 0.72,
            Shader: new("wave", new() { ["speed"] = JsonSerializer.SerializeToElement(3), ["colorB"] = JsonSerializer.SerializeToElement("#ABCDEF") })) };
        var commits = interceptor.CommitCount;
        await service.UpdateEntityAsync("ana", edited, false);
        Assert.Equal(commits, interceptor.CommitCount);
        await using (var db = factory.CreateDbContext())
            Assert.Null((await db.RoomEntities.SingleAsync()).MaterialSettingsJson);
        var confirmed = await service.UpdateEntityAsync("ana", edited, true);
        await service.UpdateEntityAsync("ana", edited, true);
        Assert.Equal(commits + 1, interceptor.CommitCount);
        Assert.Equal("#abcdef", confirmed.MaterialSettings!.Shader!.Parameters!["colorB"].GetString());
        await using (var db = factory.CreateDbContext())
            Assert.InRange((await db.RoomEntities.SingleAsync()).MaterialSettingsJson!.Length, 1, 1024);
        var restored = CreateService(factory, new RoomStateStore());
        await StartAndWaitAsync(restored);
        Assert.Equal(confirmed, Assert.Single((await restored.JoinAsync("bia", "Bia", CollaborationProtocol.Version, [])).Entities));
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

    private static async Task SeedLegacyEntityAsync(
        IDbContextFactory<RoomDbContext> factory, EntityDto legacy, string migration)
    {
        await using var database = await factory.CreateDbContextAsync();
        await database.GetService<IMigrator>().MigrateAsync(migration);
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
        if (legacy.GeometryParameters is not null)
        {
            var json = System.Text.Json.JsonSerializer.Serialize(legacy.GeometryParameters);
            await database.Database.ExecuteSqlInterpolatedAsync(
                $"""UPDATE RoomEntities SET GeometryParametersJson = {json} WHERE Id = {legacy.Id}""");
        }
    }

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
