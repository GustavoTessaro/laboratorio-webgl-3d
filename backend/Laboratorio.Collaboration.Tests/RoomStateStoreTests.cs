using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Services;

namespace Laboratorio.Collaboration.Tests;

public sealed class RoomStateStoreTests
{
    [Fact]
    public void TrajectoryValidationRejectsOvershootAndChecksWholeOrientedObject()
    {
        var entity = CreateBox() with { Position = new Vector3Dto(2, 3, 0) };
        RoomStateStore.ValidateEntity(entity with { Trajectory = new TrajectoryDto(Enabled: true) });
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            Trajectory = new TrajectoryDto(Enabled: true, Type: "catmull",
                Points: [new(-7, 0, 0), new(7, 0, 0), new(7, 0, 0), new(-7, 0, 0)])
        }));
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            Position = new Vector3Dto(0, 0.75, 0),
            Trajectory = new TrajectoryDto(Enabled: true, Orient: true)
        }));
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            Trajectory = new TrajectoryDto(Type: "catmull", Points: [new(0, 0, 0), new(0, 0, 0)])
        }));
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            Trajectory = new TrajectoryDto(Duration: double.PositiveInfinity)
        }));
    }
    private static EntityDto CreateBox(string? id = null) => new(
        id ?? Guid.NewGuid().ToString(),
        "Cubo",
        "box",
        "#6c8cff",
        "solid",
        new Vector3Dto(0, 0.75, 0),
        new Vector3Dto(0, 0, 0),
        new Vector3Dto(1, 1, 1),
        new AnimationDto(false, "y", 45));

    [Fact]
    public void FirstJoinSeedsRoomAndLaterJoinReceivesTheCurrentSnapshot()
    {
        var store = new RoomStateStore();
        var initial = CreateBox();

        var first = store.Join("connection-1", "Ana", CollaborationProtocol.Version, [initial]);
        var second = store.Join("connection-2", "Bia", CollaborationProtocol.Version, []);

        Assert.Single(first.Entities);
        Assert.Single(second.Entities);
        Assert.Equal(initial.Id, second.Entities.Single().Id);
        Assert.Equal(2, second.Participants.Count);
    }

    [Fact]
    public void UpdatedEntityAppearsInTheNextParticipantSnapshot()
    {
        var store = new RoomStateStore();
        var entity = CreateBox();
        store.Join("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
        store.AcquireLock("connection-1", entity.Id);
        store.UpdateEntity("connection-1", entity with
        {
            Position = new Vector3Dto(3, 1, -2),
            Color = "#ff0000"
        });

        var snapshot = store.Join("connection-2", "Bia", CollaborationProtocol.Version, []);

        var synchronizedEntity = Assert.Single(snapshot.Entities);
        Assert.Equal(new Vector3Dto(3, 1, -2), synchronizedEntity.Position);
        Assert.Equal("#ff0000", synchronizedEntity.Color);
        Assert.Equal("Ana", synchronizedEntity.LastEditor);
    }

    [Fact]
    public void OnlyLockOwnerCanUpdateAndReleaseLock()
    {
        var store = new RoomStateStore();
        var entity = CreateBox();
        store.Join("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
        store.Join("connection-2", "Bia", CollaborationProtocol.Version, []);

        Assert.True(store.AcquireLock("connection-1", entity.Id).Granted);
        Assert.False(store.AcquireLock("connection-2", entity.Id).Granted);
        Assert.Throws<InvalidOperationException>(() =>
            store.UpdateEntity("connection-2", entity with { Color = "#ff0000" }));
        Assert.Equal("Ana", store.UpdateEntity("connection-1", entity with { Color = "#ff0000" }).LastEditor);
        Assert.True(store.ReleaseLock("connection-1", entity.Id));
        Assert.False(store.ReleaseLock("connection-1", entity.Id));
    }

    [Fact]
    public void DisconnectReleasesOwnedLocks()
    {
        var store = new RoomStateStore();
        var entity = CreateBox();
        store.Join("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
        store.Join("connection-2", "Bia", CollaborationProtocol.Version, []);
        store.AcquireLock("connection-1", entity.Id);

        store.Leave("connection-1");

        Assert.True(store.AcquireLock("connection-2", entity.Id).Granted);
        Assert.Single(store.GetSnapshot().Participants);
    }

    [Fact]
    public void InvalidTransformAndProtocolVersionAreRejected()
    {
        Assert.Throws<InvalidOperationException>(() =>
            RoomStateStore.ValidateEntity(CreateBox() with
            {
                Position = new Vector3Dto(0, 10, 0)
            }));

        var store = new RoomStateStore();
        Assert.Throws<InvalidOperationException>(() =>
            store.Join("connection-1", "Ana", 99, []));
        Assert.Throws<InvalidOperationException>(() =>
            store.Join("connection-1", "Ana", CollaborationProtocol.Version, [CreateBox() with
            {
                Scale = new Vector3Dto(0, 1, 1)
            }]));
    }

    [Fact]
    public void CreateRejectsDuplicateIdsAndDeleteRequiresLock()
    {
        var store = new RoomStateStore();
        var existing = CreateBox();
        store.Join("connection-1", "Ana", CollaborationProtocol.Version, [existing]);

        Assert.Throws<InvalidOperationException>(() => store.CreateEntity("connection-1", existing));
        Assert.Throws<InvalidOperationException>(() => store.DeleteEntity("connection-1", existing.Id));
        Assert.True(store.AcquireLock("connection-1", existing.Id).Granted);
        Assert.True(store.DeleteEntity("connection-1", existing.Id));
        Assert.Empty(store.GetSnapshot().Entities);
    }

    [Fact]
    public void DeletingTheLastObjectDoesNotReseedTheRoomOnNextJoin()
    {
        var store = new RoomStateStore();
        var entity = CreateBox();
        store.Join("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
        store.AcquireLock("connection-1", entity.Id);
        store.DeleteEntity("connection-1", entity.Id);
        store.Leave("connection-1");

        var nextParticipant = store.Join("connection-2", "Bia", CollaborationProtocol.Version, [CreateBox()]);

        Assert.Empty(nextParticipant.Entities);
    }

    [Fact]
    public void ExpiredLockIsRemovedAndCanBeAcquiredByAnotherParticipant()
    {
        var clock = new TestTimeProvider();
        var store = new RoomStateStore(clock);
        var entity = CreateBox();
        store.Join("connection-1", "Ana", CollaborationProtocol.Version, [entity]);
        store.Join("connection-2", "Bia", CollaborationProtocol.Version, []);
        store.AcquireLock("connection-1", entity.Id);

        clock.Advance(TimeSpan.FromSeconds(21));
        var expired = store.ExpireLocks();

        Assert.Single(expired);
        Assert.Null(store.GetLock(entity.Id));
        Assert.True(store.AcquireLock("connection-2", entity.Id).Granted);
    }

    [Theory]
    [InlineData("box")]
    [InlineData("sphere")]
    [InlineData("pyramid")]
    [InlineData("torus")]
    [InlineData("cylinder")]
    [InlineData("cone")]
    [InlineData("plane")]
    [InlineData("capsule")]
    [InlineData("tetrahedron")]
    [InlineData("octahedron")]
    [InlineData("dodecahedron")]
    [InlineData("icosahedron")]
    [InlineData("torusKnot")]
    public void AcceptsEveryGeometryWithDefaultParameters(string type)
    {
        var entity = CreateBox() with { Type = type, Position = new Vector3Dto(0, 5, 0) };
        var store = new RoomStateStore();
        var snapshot = store.Join("ana", "Ana", CollaborationProtocol.Version, [entity]);
        Assert.Equal(entity, Assert.Single(snapshot.Entities));
    }

    [Fact]
    public void RejectsInvalidParametersAndUsesTheParameterizedRotatedBounds()
    {
        var box = CreateBox() with
        {
            Position = new Vector3Dto(8, 3, 0),
            Scale = new Vector3Dto(1.5, 1, 1),
            Rotation = new Vector3Dto(0, 0, Math.PI / 2),
            GeometryParameters = new GeometryParametersDto { ["width"] = 4, ["height"] = 4 }
        };
        RoomStateStore.ValidateEntity(box);
        foreach (var parameters in new[]
        {
            new GeometryParametersDto { ["width"] = 8 },
            new GeometryParametersDto { ["widthSegments"] = 24.5 },
            new GeometryParametersDto { ["heightSegments"] = 25 },
            new GeometryParametersDto { ["radius"] = 3 },
            new GeometryParametersDto { ["width"] = double.NaN }
        })
        {
            Assert.Throws<InvalidOperationException>(() =>
                RoomStateStore.ValidateEntity(box with { GeometryParameters = parameters }));
        }

        var store = new RoomStateStore();
        Assert.Throws<InvalidOperationException>(() => store.Join("legacy", "Cliente V1", 1, []));
    }

    [Fact]
    public void ValidatesMaterialValuesAndOnlyAcceptsCatalogTextureIds()
    {
        var box = CreateBox();
        foreach (var id in new[] { "wood", "brick", "marble", "stone", "metal", "concrete", "fabric", "uv-grid" })
            RoomStateStore.ValidateEntity(box with { MaterialSettings = new MaterialSettingsDto(TextureId: id) });

        foreach (var settings in new[]
        {
            new MaterialSettingsDto(Kind: "shader"),
            new MaterialSettingsDto(Side: "unknown"),
            new MaterialSettingsDto(TextureId: "https://example.com/foreign.jpg"),
            new MaterialSettingsDto(Opacity: 1.1),
            new MaterialSettingsDto(Roughness: double.NaN),
            new MaterialSettingsDto(Metalness: -0.1),
            new MaterialSettingsDto(Shininess: 201),
            new MaterialSettingsDto(Specular: "#fff"),
            new MaterialSettingsDto(Emissive: "#112233\n"),
            new MaterialSettingsDto(EmissiveIntensity: 5.5),
            new MaterialSettingsDto(RepeatV: 0),
            new MaterialSettingsDto(OffsetU: 1.01),
            new MaterialSettingsDto(TextureRotation: -181),
        })
            Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(box with { MaterialSettings = settings }));

        var store = new RoomStateStore();
        Assert.Throws<InvalidOperationException>(() => store.Join("v2", "Cliente V2", 2, []));
        var joined = store.Join("ana", "Ana", CollaborationProtocol.Version, [
            box with { MaterialSettings = new MaterialSettingsDto() }
        ]);
        Assert.Null(Assert.Single(joined.Entities).MaterialSettings);
    }

    private sealed class TestTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now += duration;
    }
}
