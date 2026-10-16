using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Data;
using Microsoft.EntityFrameworkCore;

namespace Laboratorio.Collaboration.Services;

public sealed class RoomPersistenceService(
    IDbContextFactory<RoomDbContext> contextFactory,
    RoomStateStore store,
    ILogger<RoomPersistenceService> logger) : IHostedService
{
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly Dictionary<string, EntityDto> _persistedEntities = new(StringComparer.Ordinal);

    public async Task StartAsync(CancellationToken cancellationToken)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
            await context.Database.MigrateAsync(cancellationToken);

            var roomId = CollaborationProtocol.RoomId;
            var roomExists = await context.Rooms
                .AsNoTracking()
                .AnyAsync(room => room.RoomId == roomId, cancellationToken);
            var records = roomExists
                ? await context.RoomEntities
                    .AsNoTracking()
                    .Where(entity => entity.RoomId == roomId)
                    .ToListAsync(cancellationToken)
                : [];
            var entities = records.Select(ToDto).ToArray();
            store.InitializeFromPersistence(entities, roomExists);
            _persistedEntities.Clear();
            foreach (var entity in entities)
            {
                _persistedEntities.Add(entity.Id, entity);
            }
        }
        catch (Exception exception)
        {
            logger.LogError(exception, "Não foi possível inicializar o estado persistido da sala.");
            throw;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public Task StopAsync(CancellationToken cancellationToken) => Task.CompletedTask;

    public async Task<RoomSnapshotDto> JoinAsync(
        string connectionId,
        string displayName,
        int protocolVersion,
        IReadOnlyCollection<EntityDto> initialEntities)
    {
        await _writeLock.WaitAsync();
        try
        {
            var firstJoin = !store.IsInitialized;
            var snapshot = store.Join(connectionId, displayName, protocolVersion, initialEntities);
            if (!firstJoin)
            {
                return snapshot;
            }

            try
            {
                await SaveInitialRoomAsync(snapshot.Entities);
                ReplacePersistedEntities(snapshot.Entities);
                return snapshot;
            }
            catch (Exception exception)
            {
                store.InitializeFromPersistence(_persistedEntities.Values, false);
                throw CreatePersistenceException("Não foi possível salvar o cenário inicial.", exception);
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task<EntityDto> CreateEntityAsync(string connectionId, EntityDto entity)
    {
        await _writeLock.WaitAsync();
        try
        {
            var created = store.CreateEntity(connectionId, entity);
            try
            {
                await SaveEntityAsync(created.Id, created);
                _persistedEntities.Add(created.Id, created);
                return created;
            }
            catch (Exception exception)
            {
                store.RestoreEntity(created.Id, null);
                throw CreatePersistenceException("Não foi possível persistir a criação do objeto.", exception);
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task<EntityDto> UpdateEntityAsync(string connectionId, EntityDto entity, bool final)
    {
        await _writeLock.WaitAsync();
        try
        {
            var updated = store.UpdateEntity(connectionId, entity);
            if (!final)
            {
                return updated;
            }

            try
            {
                await SaveEntityAsync(updated.Id, updated);
                _persistedEntities[updated.Id] = updated;
                return updated;
            }
            catch (Exception exception)
            {
                store.RestoreEntity(
                    updated.Id,
                    _persistedEntities.TryGetValue(updated.Id, out var persisted) ? persisted : null);
                throw CreatePersistenceException("Não foi possível persistir a edição do objeto.", exception);
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }

    public async Task<bool> DeleteEntityAsync(string connectionId, string entityId)
    {
        await _writeLock.WaitAsync();
        try
        {
            if (!store.DeleteEntity(connectionId, entityId, releaseLock: false))
            {
                return false;
            }

            try
            {
                await SaveEntityAsync(entityId, null);
                _persistedEntities.Remove(entityId);
                store.ReleaseLock(connectionId, entityId);
                return true;
            }
            catch (Exception exception)
            {
                if (_persistedEntities.TryGetValue(entityId, out var persisted))
                {
                    store.RestoreEntity(entityId, persisted);
                }

                throw CreatePersistenceException("Não foi possível persistir a exclusão do objeto.", exception);
            }
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task SaveInitialRoomAsync(IReadOnlyCollection<EntityDto> entities)
    {
        await using var context = await contextFactory.CreateDbContextAsync();
        await using var transaction = await context.Database.BeginTransactionAsync();
        context.Rooms.Add(new RoomRecord
        {
            RoomId = CollaborationProtocol.RoomId,
            UpdatedAtUtc = DateTime.UtcNow
        });
        context.RoomEntities.AddRange(entities.Select(ToRecord));
        await context.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    private async Task SaveEntityAsync(string entityId, EntityDto? entity)
    {
        await using var context = await contextFactory.CreateDbContextAsync();
        await using var transaction = await context.Database.BeginTransactionAsync();
        var room = await context.Rooms.SingleOrDefaultAsync(record =>
            record.RoomId == CollaborationProtocol.RoomId);
        if (room is null)
        {
            throw new InvalidOperationException("A sala não foi inicializada no banco de dados.");
        }

        var storedEntity = await context.RoomEntities.SingleOrDefaultAsync(record =>
            record.RoomId == CollaborationProtocol.RoomId && record.Id == entityId);
        if (entity is null)
        {
            if (storedEntity is not null)
            {
                context.RoomEntities.Remove(storedEntity);
            }
        }
        else if (storedEntity is null)
        {
            context.RoomEntities.Add(ToRecord(entity));
        }
        else
        {
            CopyToRecord(entity, storedEntity);
        }

        room.UpdatedAtUtc = DateTime.UtcNow;
        await context.SaveChangesAsync();
        await transaction.CommitAsync();
    }

    private static RoomEntityRecord ToRecord(EntityDto entity)
    {
        var record = new RoomEntityRecord();
        CopyToRecord(entity, record);
        return record;
    }

    private static void CopyToRecord(EntityDto entity, RoomEntityRecord record)
    {
        record.RoomId = CollaborationProtocol.RoomId;
        record.Id = entity.Id;
        record.Name = entity.Name;
        record.Type = entity.Type;
        record.Color = entity.Color;
        record.MaterialMode = entity.MaterialMode;
        record.PositionX = entity.Position.X;
        record.PositionY = entity.Position.Y;
        record.PositionZ = entity.Position.Z;
        record.RotationX = entity.Rotation.X;
        record.RotationY = entity.Rotation.Y;
        record.RotationZ = entity.Rotation.Z;
        record.ScaleX = entity.Scale.X;
        record.ScaleY = entity.Scale.Y;
        record.ScaleZ = entity.Scale.Z;
        record.AnimationEnabled = entity.Animation.Enabled;
        record.AnimationAxis = entity.Animation.Axis;
        record.AnimationSpeed = entity.Animation.Speed;
        record.LastEditor = entity.LastEditor;
    }

    private static EntityDto ToDto(RoomEntityRecord record) => new(
        record.Id,
        record.Name,
        record.Type,
        record.Color,
        record.MaterialMode,
        new Vector3Dto(record.PositionX, record.PositionY, record.PositionZ),
        new Vector3Dto(record.RotationX, record.RotationY, record.RotationZ),
        new Vector3Dto(record.ScaleX, record.ScaleY, record.ScaleZ),
        new AnimationDto(record.AnimationEnabled, record.AnimationAxis, record.AnimationSpeed),
        record.LastEditor);

    private void ReplacePersistedEntities(IEnumerable<EntityDto> entities)
    {
        _persistedEntities.Clear();
        foreach (var entity in entities)
        {
            _persistedEntities.Add(entity.Id, entity);
        }
    }

    private RoomPersistenceException CreatePersistenceException(string message, Exception exception)
    {
        logger.LogError(exception, "{PersistenceError}", message);
        return new RoomPersistenceException(message, exception);
    }
}

public sealed class RoomPersistenceException(string message, Exception innerException)
    : Exception(message, innerException);
