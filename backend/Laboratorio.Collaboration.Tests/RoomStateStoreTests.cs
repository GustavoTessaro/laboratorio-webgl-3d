using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Services;

namespace Laboratorio.Collaboration.Tests;

public sealed class RoomStateStoreTests
{
    [Fact]
    public void CatalogModelsRequireKnownIdsOriginalMaterialsAndSafeHierarchyBounds()
    {
        var entity = CreateBox() with { Type = "model-beacon", Position = new Vector3Dto(0, 4, 0) };
        foreach (var type in new[] { "model-beacon", "model-arch", "model-satellite" })
            RoomStateStore.ValidateEntity(entity with { Type = type, Trajectory = new(Enabled: true) });
        foreach (var invalid in new[]
        {
            entity with { Type = "local-model" }, entity with { Type = "https://example.com/model.glb" },
            entity with { Type = "model-unknown" },
            entity with { GeometryParameters = new() { ["url"] = 1 } },
            entity with { MaterialSettings = new(Kind: "basic") },
            entity with { Position = new(0, 1.1, 0), Animation = new(true, "y", 45) },
            entity with { Position = new(0, 1.1, 0), Trajectory = new(Enabled: true, Type: "helix", Height: -2) }
        })
            Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(invalid));

        var store = new RoomStateStore();
        store.Join("ana", "Ana", CollaborationProtocol.Version, []);
        for (var i = 0; i < 6; i++)
            store.CreateEntity("ana", entity with { Id = Guid.NewGuid().ToString() });
        Assert.Throws<InvalidOperationException>(() => store.CreateEntity("ana", entity));
        Assert.Equal(6, store.GetSnapshot().Entities.Count);
    }

    [Fact]
    public void KnownShadersValidateAndWaveUsesTheSameBoundsAsTheFrontend()
    {
        var entity = CreateBox() with { Position = new Vector3Dto(0, 3, 0) };
        foreach (var id in new[] { "gradient", "wave", "checker", "fresnel", "lava", "hologram" })
            RoomStateStore.ValidateEntity(entity with { MaterialSettings = new(Kind: "shader", Shader: new(id)) });
        var material = new MaterialSettingsDto(Kind: "shader", Shader: new("wave", new()
        {
            ["amplitude"] = System.Text.Json.JsonSerializer.SerializeToElement(0.35)
        }));
        RoomStateStore.ValidateEntity(entity with { MaterialSettings = material,
            Trajectory = new(Enabled: true), Animation = new(true, "y", 45) });
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            MaterialSettings = material, Position = new(0, 0.75, 0)
        }));
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            MaterialSettings = material, Position = new(9.15, 3, 0), Rotation = new(0, 0, Math.PI / 2)
        }));
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            MaterialSettings = material, Animation = new(true, "y", 45), Trajectory = new(Enabled: true, Type: "helix", Height: -2)
        }));
        foreach (var shader in new ShaderDescriptorDto[]
        {
            new("unknown"), new("fresnel", new() { ["glsl"] = System.Text.Json.JsonSerializer.SerializeToElement("void main() {}") }),
            new("wave", new() { ["amplitude"] = System.Text.Json.JsonSerializer.SerializeToElement(1) }),
            new("checker", new() { ["scale"] = System.Text.Json.JsonSerializer.SerializeToElement("8") })
        })
            Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
            {
                MaterialSettings = material with { Shader = shader }
            }));
        Assert.Throws<System.Text.Json.JsonException>(() =>
            System.Text.Json.JsonSerializer.Deserialize<ShaderDescriptorDto>("""{"Id":"gradient","VertexShader":"void main(){}"}"""));
    }

    [Fact]
    public void ModelingPresetsAndSpatialLimitsUseTheSharedCatalog()
    {
        using var stream = typeof(RoomStateStore).Assembly.GetManifestResourceStream("GeometryCatalog.json")!;
        using var json = System.Text.Json.JsonDocument.Parse(stream);
        var entity = CreateBox() with { Position = new Vector3Dto(0, 4, 0) };
        foreach (var type in new[] { "lathe", "extrude" })
        {
            var presets = json.RootElement.GetProperty(type).GetProperty("modeling").GetProperty("presets");
            foreach (var preset in presets.EnumerateObject())
            {
                var parameters = ModelPoints(preset.Value.GetProperty("points").EnumerateArray()
                    .Select(pair => (pair[0].GetDouble(), pair[1].GetDouble())).ToArray());
                if (preset.Value.TryGetProperty("rounded", out var rounded) && rounded.GetBoolean())
                    parameters["rounded"] = 1;
                RoomStateStore.ValidateEntity(entity with { Type = type, GeometryParameters = parameters });
            }
        }

        var tall = ModelPoints((1, -2), (1, 2));
        var rotation = new Vector3Dto(0, 0, Math.PI / 2);
        RoomStateStore.ValidateEntity(entity with { Type = "lathe", GeometryParameters = tall, Rotation = rotation });
        Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(entity with
        {
            Type = "lathe", GeometryParameters = tall, Rotation = rotation, Position = new Vector3Dto(7.5, 4, 0),
            Trajectory = new TrajectoryDto(Enabled: true, Radius: 1)
        }));
    }

    [Fact]
    public void ModelingRejectsInvalidPointEncodingDegeneracyAndMeshBudget()
    {
        var entity = CreateBox() with { Position = new Vector3Dto(0, 4, 0) };
        var nearEdge = ModelPoints((0, 0), (1, 0), (0.01, 0.0001));
        var bowtie = ModelPoints((0, 0), (1, 1), (0, 1), (1, 0));
        var rounded = ModelPoints((-2, -2), (2, -2), (2, 2), (-2, 2));
        rounded["rounded"] = 1;
        rounded["curveSegments"] = 12;
        rounded["depthSegments"] = 32;
        var tight = ModelPoints((0, 0), (0.2, 0), (0.2, 0.2), (0, 0.2));
        tight["bevelEnabled"] = 1;
        tight["bevelSize"] = 0.4;
        foreach (var (type, parameters) in new (string, GeometryParametersDto)[]
        {
            ("lathe", ModelPoints((-1, 0), (1, 1))),
            ("lathe", ModelPoints((1, 1), (1, 0))),
            ("lathe", ModelPoints((1, 0), (0, 1), (1, 2))),
            ("lathe", new() { ["pointCount"] = 2, ["x0"] = 200, ["y0"] = 10, ["x1"] = 20 }),
            ("extrude", nearEdge), ("extrude", bowtie), ("extrude", rounded), ("extrude", tight),
            ("extrude", new() { ["x0"] = 1 })
        })
            Assert.Throws<InvalidOperationException>(() => RoomStateStore.ValidateEntity(
                entity with { Type = type, GeometryParameters = parameters }));
    }

    private static GeometryParametersDto ModelPoints(params (double X, double Y)[] points)
    {
        var parameters = new GeometryParametersDto { ["pointCount"] = points.Length };
        for (var i = 0; i < points.Length; i++)
        {
            parameters[$"x{i}"] = Math.Round(points[i].X * 10000);
            parameters[$"y{i}"] = Math.Round(points[i].Y * 10000);
        }
        return parameters;
    }

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
