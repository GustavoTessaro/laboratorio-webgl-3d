using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Services;
using Microsoft.AspNetCore.SignalR;

namespace Laboratorio.Collaboration.Hubs;

public sealed class LaboratoryHub(RoomStateStore store) : Hub
{
    public async Task<RoomSnapshotDto> JoinRoom(
        string displayName,
        int protocolVersion,
        IReadOnlyCollection<EntityDto>? initialEntities)
    {
        var snapshot = store.Join(
            Context.ConnectionId,
            displayName,
            protocolVersion,
            initialEntities ?? Array.Empty<EntityDto>());
        await Groups.AddToGroupAsync(Context.ConnectionId, CollaborationProtocol.RoomId);
        await Clients.OthersInGroup(CollaborationProtocol.RoomId)
            .SendAsync("ParticipantJoined", snapshot.Participants.Single(p => p.Id == Context.ConnectionId));
        return snapshot;
    }

    public async Task<LockResultDto> AcquireEditLock(string entityId)
    {
        var result = store.AcquireLock(Context.ConnectionId, entityId);
        if (result.Granted)
        {
            var entityLock = store.GetLock(entityId)!;
            await Clients.Group(CollaborationProtocol.RoomId).SendAsync("LockChanged", entityLock);
        }

        return result;
    }

    public async Task<bool> RenewEditLock(string entityId)
    {
        return store.RenewLock(Context.ConnectionId, entityId);
    }

    public async Task ReleaseEditLock(string entityId)
    {
        if (store.ReleaseLock(Context.ConnectionId, entityId))
        {
            await Clients.Group(CollaborationProtocol.RoomId)
                .SendAsync("LockChanged", new EditLockDto(entityId, string.Empty, string.Empty));
        }
    }

    public async Task<EntityDto> CreateEntity(EntityDto entity)
    {
        var stored = store.CreateEntity(Context.ConnectionId, entity);
        await Clients.Group(CollaborationProtocol.RoomId).SendAsync("EntityUpserted", stored);
        return stored;
    }

    public async Task<EntityDto> UpdateEntity(EntityDto entity, bool final)
    {
        var stored = store.UpdateEntity(Context.ConnectionId, entity);
        await Clients.OthersInGroup(CollaborationProtocol.RoomId).SendAsync("EntityUpserted", stored);
        if (final)
        {
            await Clients.Caller.SendAsync("EntityUpserted", stored);
        }

        return stored;
    }

    public async Task DeleteEntity(string entityId)
    {
        if (!store.DeleteEntity(Context.ConnectionId, entityId))
        {
            throw new HubException("O objeto não existe mais na sala.");
        }

        await Clients.Group(CollaborationProtocol.RoomId).SendAsync("EntityDeleted", entityId);
        await Clients.Group(CollaborationProtocol.RoomId)
            .SendAsync("LockChanged", new EditLockDto(entityId, string.Empty, string.Empty));
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        var departure = store.Leave(Context.ConnectionId);
        var participant = departure.Participant;
        if (participant is not null)
        {
            await Clients.OthersInGroup(CollaborationProtocol.RoomId)
                .SendAsync("ParticipantLeft", participant.Id);
        }
        foreach (var releasedLock in departure.ReleasedLocks)
        {
            await Clients.OthersInGroup(CollaborationProtocol.RoomId)
                .SendAsync("LockChanged", new EditLockDto(
                    releasedLock.EntityId,
                    string.Empty,
                    string.Empty));
        }

        await base.OnDisconnectedAsync(exception);
    }
}
