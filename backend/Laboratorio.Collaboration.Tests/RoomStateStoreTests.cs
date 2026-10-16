using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Services;

namespace Laboratorio.Collaboration.Tests;

public sealed class RoomStateStoreTests
{
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

        var first = store.Join("connection-1", "Ana", 1, [initial]);
        var second = store.Join("connection-2", "Bia", 1, []);

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
        store.Join("connection-1", "Ana", 1, [entity]);
        store.AcquireLock("connection-1", entity.Id);
        store.UpdateEntity("connection-1", entity with
        {
            Position = new Vector3Dto(3, 1, -2),
            Color = "#ff0000"
        });

        var snapshot = store.Join("connection-2", "Bia", 1, []);

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
        store.Join("connection-1", "Ana", 1, [entity]);
        store.Join("connection-2", "Bia", 1, []);

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
        store.Join("connection-1", "Ana", 1, [entity]);
        store.Join("connection-2", "Bia", 1, []);
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
            store.Join("connection-1", "Ana", 1, [CreateBox() with
            {
                Scale = new Vector3Dto(0, 1, 1)
            }]));
    }

    [Fact]
    public void CreateRejectsDuplicateIdsAndDeleteRequiresLock()
    {
        var store = new RoomStateStore();
        var existing = CreateBox();
        store.Join("connection-1", "Ana", 1, [existing]);

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
        store.Join("connection-1", "Ana", 1, [entity]);
        store.AcquireLock("connection-1", entity.Id);
        store.DeleteEntity("connection-1", entity.Id);
        store.Leave("connection-1");

        var nextParticipant = store.Join("connection-2", "Bia", 1, [CreateBox()]);

        Assert.Empty(nextParticipant.Entities);
    }

    [Fact]
    public void ExpiredLockIsRemovedAndCanBeAcquiredByAnotherParticipant()
    {
        var clock = new TestTimeProvider();
        var store = new RoomStateStore(clock);
        var entity = CreateBox();
        store.Join("connection-1", "Ana", 1, [entity]);
        store.Join("connection-2", "Bia", 1, []);
        store.AcquireLock("connection-1", entity.Id);

        clock.Advance(TimeSpan.FromSeconds(21));
        var expired = store.ExpireLocks();

        Assert.Single(expired);
        Assert.Null(store.GetLock(entity.Id));
        Assert.True(store.AcquireLock("connection-2", entity.Id).Granted);
    }

    private sealed class TestTimeProvider : TimeProvider
    {
        private DateTimeOffset _now = DateTimeOffset.UtcNow;

        public override DateTimeOffset GetUtcNow() => _now;

        public void Advance(TimeSpan duration) => _now += duration;
    }
}
