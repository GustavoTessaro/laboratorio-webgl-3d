using System.Text.Json;
using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Services;
using Microsoft.AspNetCore.SignalR;

namespace Laboratorio.Collaboration.Hubs;

public sealed class LaboratoryHub(RoomStateStore store, RoomPersistenceService persistence, RoomInvocationOrder order) : Hub
{
    public async Task<string[]> ApplyEnvironment(EnvironmentCommandDto command)
    {
        try
        {
            var change = await persistence.ApplyEnvironmentAsync(Context.ConnectionId, command);
            if (change is not null)
            {
                try
                {
                    await Clients.Group(CollaborationProtocol.RoomId).SendAsync("EnvironmentApplied", change);
                }
                catch
                {
                    persistence.ReconcileEnvironmentDelivery();
                    throw new HubException("Aguarde a reconciliação da aplicação do ambiente.");
                }
            }
            return change?.Entities.Select(entity => entity.Id).ToArray() ?? [];
        }
        catch (Exception error) when (error is RoomPersistenceException or InvalidOperationException)
        {
            var rejected = error is InvalidOperationException ||
                (error is RoomPersistenceException { RequiresReconciliation: false } && persistence.IsReady);
            throw new HubException(rejected ? $"Ambiente rejeitado. {error.Message}" : error.Message);
        }
    }
    public async Task<RoomSnapshotDto> JoinRoom(
        string displayName,
        int protocolVersion,
        IReadOnlyCollection<EntityDto>? initialEntities)
    {
        if (protocolVersion != CollaborationProtocol.Version)
            throw new HubException("Versão de colaboração incompatível. Atualize a página para entrar na sala.");

        RoomSnapshotDto snapshot;
        try
        {
            snapshot = await persistence.JoinAsync(
                Context.ConnectionId,
                displayName,
                protocolVersion,
                initialEntities ?? Array.Empty<EntityDto>());
        }
        catch (RoomPersistenceException exception)
        {
            throw new HubException(exception.Message);
        }

        await Groups.AddToGroupAsync(Context.ConnectionId, CollaborationProtocol.RoomId);
        await Clients.OthersInGroup(CollaborationProtocol.RoomId)
            .SendAsync("ParticipantJoined", snapshot.Participants.Single(p => p.Id == Context.ConnectionId));
        return snapshot with { Lighting = store.GetLighting(), Particles = store.GetParticles() };
    }

    public async Task<RoomLightingDto> UpdateLighting(string? group, JsonElement? patch)
    {
        try
        {
            var (state, changed) = await persistence.UpdateLightingAsync(Context.ConnectionId, group, patch);
            if (changed)
                await Clients.Group(CollaborationProtocol.RoomId).SendAsync("RoomLightingChanged", state);
            return state;
        }
        catch (Exception error) when (error is RoomPersistenceException or InvalidOperationException)
        {
            throw new HubException(error.Message);
        }
    }

    public async Task<RoomParticlesDto> UpdateParticles(ParticleCommandDto command)
    {
        try
        {
            var (state, changed) = await persistence.UpdateParticlesAsync(Context.ConnectionId, command);
            if (changed)
                await Clients.Group(CollaborationProtocol.RoomId).SendAsync("RoomParticlesChanged", state);
            return state;
        }
        catch (Exception error) when (error is RoomPersistenceException or InvalidOperationException)
        {
            throw new HubException(error.Message);
        }
    }

    public async Task<LockResultDto> AcquireEditLock(string entityId)
    {
        var discardedPreview = false;
        var result = store.AcquireLock(Context.ConnectionId, entityId, _ => discardedPreview = true);
        if (result.Granted)
        {
            if (discardedPreview)
                await BroadcastConfirmedAsync(Clients.Group(CollaborationProtocol.RoomId), store, entityId);
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
        var discardedPreview = false;
        if (store.ReleaseLock(Context.ConnectionId, entityId, _ => discardedPreview = true))
        {
            if (discardedPreview)
                await BroadcastConfirmedAsync(Clients.OthersInGroup(CollaborationProtocol.RoomId), store, entityId);
            await Clients.Group(CollaborationProtocol.RoomId)
                .SendAsync("LockChanged", new EditLockDto(entityId, string.Empty, string.Empty));
        }
    }

    public async Task<EntityDto> CreateEntity(EntityDto entity)
    {
        EntityDto stored;
        try
        {
            stored = await persistence.CreateEntityAsync(Context.ConnectionId, entity);
        }
        catch (RoomPersistenceException exception)
        {
            throw new HubException(exception.Message);
        }

        await Clients.Group(CollaborationProtocol.RoomId).SendAsync("EntityUpserted", stored);
        return stored;
    }

    public async Task<EntityDto> UpdateEntity(EntityDto entity, bool final)
    {
        EntityDto stored;
        try
        {
            stored = await persistence.UpdateEntityAsync(Context.ConnectionId, entity, final);
        }
        catch (RoomPersistenceException exception)
        {
            var authoritative = exception.RequiresReconciliation
                ? null
                : store.GetEntity(entity.Id);
            if (authoritative is not null)
            {
                await Clients.Group(CollaborationProtocol.RoomId)
                    .SendAsync("EntityUpserted", authoritative);
            }

            throw new HubException(exception.Message);
        }

        await Clients.OthersInGroup(CollaborationProtocol.RoomId).SendAsync("EntityUpserted", stored);
        if (final)
        {
            await Clients.Caller.SendAsync("EntityUpserted", stored);
        }

        return stored;
    }

    public async Task DeleteEntity(string entityId)
    {
        bool deleted;
        try
        {
            deleted = await persistence.DeleteEntityAsync(Context.ConnectionId, entityId);
        }
        catch (RoomPersistenceException exception)
        {
            var authoritative = exception.RequiresReconciliation ? null : store.GetEntity(entityId);
            if (authoritative is not null)
            {
                await Clients.Group(CollaborationProtocol.RoomId)
                    .SendAsync("EntityUpserted", authoritative);
            }

            throw new HubException(exception.Message);
        }

        if (!deleted)
        {
            throw new HubException("O objeto não existe mais na sala.");
        }

        await Clients.Group(CollaborationProtocol.RoomId).SendAsync("EntityDeleted", entityId);
        await Clients.Group(CollaborationProtocol.RoomId)
            .SendAsync("LockChanged", new EditLockDto(entityId, string.Empty, string.Empty));
    }

    public override async Task OnDisconnectedAsync(Exception? exception)
    {
        await order.EnterAsync();
        try { await NotifyDepartureAsync(); }
        finally { order.Exit(); }
        await base.OnDisconnectedAsync(exception);
    }

    private async Task NotifyDepartureAsync()
    {
        var discardedPreviews = new HashSet<string>(StringComparer.Ordinal);
        var departure = store.Leave(Context.ConnectionId, id => { discardedPreviews.Add(id); });
        var participant = departure.Participant;
        if (participant is not null)
        {
            await Clients.OthersInGroup(CollaborationProtocol.RoomId)
                .SendAsync("ParticipantLeft", participant.Id);
        }
        foreach (var releasedLock in departure.ReleasedLocks)
        {
            if (discardedPreviews.Contains(releasedLock.EntityId))
                await BroadcastConfirmedAsync(
                    Clients.OthersInGroup(CollaborationProtocol.RoomId), store, releasedLock.EntityId);
            await Clients.OthersInGroup(CollaborationProtocol.RoomId)
                .SendAsync("LockChanged", new EditLockDto(
                    releasedLock.EntityId,
                    string.Empty,
                    string.Empty));
        }

    }

    internal static Task BroadcastConfirmedAsync(
        IClientProxy clients, RoomStateStore store, string entityId, CancellationToken cancellationToken = default)
    {
        var entity = store.GetEntity(entityId);
        return entity is null
            ? Task.CompletedTask
            : clients.SendAsync("EntityUpserted", entity, cancellationToken);
    }
}
