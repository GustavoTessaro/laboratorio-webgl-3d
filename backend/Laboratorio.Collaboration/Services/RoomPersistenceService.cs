using Laboratorio.Collaboration.Contracts;
using Laboratorio.Collaboration.Data;
using Laboratorio.Collaboration.Hubs;
using Microsoft.AspNetCore.SignalR;
using Microsoft.Data.SqlClient;
using Microsoft.EntityFrameworkCore;

namespace Laboratorio.Collaboration.Services;

public sealed class RoomPersistenceService(
    IDbContextFactory<RoomDbContext> contextFactory,
    RoomStateStore store,
    ILogger<RoomPersistenceService> logger,
    bool applyMigrationsOnStartup = true,
    TimeSpan? recoveryInterval = null,
    IHubContext<LaboratoryHub>? hubContext = null) : BackgroundService
{
    private readonly TimeSpan _recoveryInterval = recoveryInterval ?? TimeSpan.FromSeconds(10);
    private readonly SemaphoreSlim _writeLock = new(1, 1);
    private readonly Dictionary<string, EntityDto> _persistedEntities = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EntityDto> _pendingUpserts = new(StringComparer.Ordinal);
    private readonly HashSet<string> _pendingDeletes = new(StringComparer.Ordinal);
    private readonly HashSet<string> _pendingLockReleases = new(StringComparer.Ordinal);
    private readonly HashSet<string> _pendingEntityReconciliations = new(StringComparer.Ordinal);
    private readonly object _reconciliationSync = new();
    private CancellationToken _stoppingToken;
    private Task? _reconciliationTask;
    private volatile bool _isReady;

    public bool IsReady => _isReady;

    protected override async Task ExecuteAsync(CancellationToken stoppingToken)
    {
        _stoppingToken = stoppingToken;
        var outageReported = false;
        while (!stoppingToken.IsCancellationRequested)
        {
            try
            {
                await InitializeFromDatabaseAsync(stoppingToken);
                if (outageReported)
                {
                    logger.LogInformation("A conexão com o banco foi restabelecida e a sala foi carregada.");
                }
                return;
            }
            catch (OperationCanceledException) when (stoppingToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception) when (IsTransientDatabaseFailure(exception))
            {
                if (!outageReported)
                {
                    logger.LogWarning(
                        exception,
                        "O banco está temporariamente indisponível. A sala permanecerá fechada até a recuperação; novas tentativas ocorrerão a cada {RetryIntervalSeconds} segundos.",
                        _recoveryInterval.TotalSeconds);
                    outageReported = true;
                }

                await Task.Delay(_recoveryInterval, stoppingToken);
            }
            catch (Exception exception)
            {
                logger.LogCritical(
                    exception,
                    "Não foi possível inicializar a persistência da sala. Verifique a configuração, as credenciais e o esquema do banco.");
                throw;
            }
        }
    }

    public override async Task StopAsync(CancellationToken cancellationToken)
    {
        await base.StopAsync(cancellationToken);
        Task? reconciliationTask;
        lock (_reconciliationSync)
        {
            reconciliationTask = _reconciliationTask;
        }

        if (reconciliationTask is not null)
        {
            await reconciliationTask.WaitAsync(cancellationToken);
        }
    }

    private async Task InitializeFromDatabaseAsync(CancellationToken cancellationToken)
    {
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
            if (applyMigrationsOnStartup)
            {
                await context.Database.MigrateAsync(cancellationToken);
            }
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
            ReplacePersistedEntities(entities);
            _isReady = true;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private async Task ReconcileFromDatabaseAsync(CancellationToken cancellationToken)
    {
        IReadOnlyCollection<EntityDto> previousEntities;
        IReadOnlyCollection<EditLockDto> previousLocks;
        RoomSnapshotDto persistedSnapshot;

        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            var before = store.GetSnapshot();
            previousEntities = before.Entities;
            previousLocks = before.Locks;
            await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
            var roomExists = await context.Rooms
                .AsNoTracking()
                .AnyAsync(room => room.RoomId == CollaborationProtocol.RoomId, cancellationToken);
            var records = roomExists
                ? await context.RoomEntities
                    .AsNoTracking()
                    .Where(entity => entity.RoomId == CollaborationProtocol.RoomId)
                    .ToListAsync(cancellationToken)
                : [];
            var entities = records.Select(ToDto).ToArray();
            store.InitializeFromPersistence(entities, roomExists);
            ReplacePersistedEntities(entities);
            persistedSnapshot = store.GetSnapshot();
            TrackReconciliationChanges(previousEntities, previousLocks, persistedSnapshot);
            foreach (var entityId in _pendingEntityReconciliations)
            {
                var currentEntity = persistedSnapshot.Entities
                    .SingleOrDefault(entity => entity.Id == entityId);
                if (currentEntity is null)
                {
                    _pendingUpserts.Remove(entityId);
                    _pendingDeletes.Add(entityId);
                }
                else
                {
                    _pendingDeletes.Remove(entityId);
                    _pendingUpserts[entityId] = currentEntity;
                }
            }
        }
        finally
        {
            _writeLock.Release();
        }

        await BroadcastReconciledStateAsync(cancellationToken);
        await _writeLock.WaitAsync(cancellationToken);
        try
        {
            _pendingUpserts.Clear();
            _pendingDeletes.Clear();
            _pendingLockReleases.Clear();
            _pendingEntityReconciliations.Clear();
            _isReady = true;
        }
        finally
        {
            _writeLock.Release();
        }
    }

    private void TrackReconciliationChanges(
        IReadOnlyCollection<EntityDto> previousEntities,
        IReadOnlyCollection<EditLockDto> previousLocks,
        RoomSnapshotDto persistedSnapshot)
    {
        var currentEntities = persistedSnapshot.Entities.ToDictionary(entity => entity.Id, StringComparer.Ordinal);
        var previousById = previousEntities.ToDictionary(entity => entity.Id, StringComparer.Ordinal);
        foreach (var entity in previousEntities)
        {
            if (!currentEntities.ContainsKey(entity.Id))
            {
                _pendingUpserts.Remove(entity.Id);
                _pendingDeletes.Add(entity.Id);
            }
        }

        foreach (var entity in persistedSnapshot.Entities)
        {
            if (!previousById.TryGetValue(entity.Id, out var previous) || previous != entity ||
                _pendingDeletes.Contains(entity.Id))
            {
                _pendingDeletes.Remove(entity.Id);
                _pendingUpserts[entity.Id] = entity;
            }
        }

        foreach (var editLock in previousLocks)
        {
            if (!currentEntities.ContainsKey(editLock.EntityId))
            {
                store.ReleaseLock(editLock.ParticipantId, editLock.EntityId);
                _pendingLockReleases.Add(editLock.EntityId);
            }
        }
    }

    private async Task BroadcastReconciledStateAsync(CancellationToken cancellationToken)
    {
        if (hubContext is null)
        {
            return;
        }

        foreach (var entityId in _pendingDeletes)
        {
            await hubContext.Clients.Group(CollaborationProtocol.RoomId)
                .SendAsync("EntityDeleted", entityId, cancellationToken);
        }

        foreach (var entity in _pendingUpserts.Values)
        {
            await hubContext.Clients.Group(CollaborationProtocol.RoomId)
                .SendAsync("EntityUpserted", entity, cancellationToken);
        }

        foreach (var entityId in _pendingLockReleases)
        {
            await hubContext.Clients.Group(CollaborationProtocol.RoomId)
                .SendAsync("LockChanged", new EditLockDto(entityId, string.Empty, string.Empty), cancellationToken);
        }
    }

    private async Task ResolveEntityWriteAsync(
        string entityId,
        EntityDto? expectedEntity,
        Exception writeException,
        string errorMessage)
    {
        PersistedRoomState persistedState;
        try
        {
            persistedState = await ReadPersistedRoomAsync(_stoppingToken);
        }
        catch (Exception verificationException)
        {
            MarkStateUncertain(entityId);
            throw CreatePersistenceException(
                "Não foi possível confirmar o resultado da gravação. A sala será reconciliada antes de aceitar novas alterações.",
                new AggregateException(writeException, verificationException),
                requiresReconciliation: true);
        }

        var storedEntity = persistedState.Entities.SingleOrDefault(entity => entity.Id == entityId);
        if (persistedState.RoomExists &&
            ((expectedEntity is null && storedEntity is null) ||
             (expectedEntity is not null && expectedEntity == storedEntity)))
        {
            ReplacePersistedEntities(persistedState.Entities);
            return;
        }

        ApplyPersistedState(persistedState);
        throw CreatePersistenceException(errorMessage, writeException);
    }

    private async Task ResolveInitialRoomWriteAsync(
        IReadOnlyCollection<EntityDto> expectedEntities,
        Exception writeException,
        string errorMessage)
    {
        PersistedRoomState persistedState;
        try
        {
            persistedState = await ReadPersistedRoomAsync(_stoppingToken);
        }
        catch (Exception verificationException)
        {
            MarkStateUncertain();
            throw CreatePersistenceException(
                "Não foi possível confirmar a criação inicial da sala. A sala será reconciliada antes de aceitar novas alterações.",
                new AggregateException(writeException, verificationException),
                requiresReconciliation: true);
        }

        if (persistedState.RoomExists &&
            persistedState.Entities.Length == expectedEntities.Count &&
            expectedEntities.All(expected => persistedState.Entities.Contains(expected)))
        {
            ReplacePersistedEntities(persistedState.Entities);
            return;
        }

        ApplyPersistedState(persistedState);
        throw CreatePersistenceException(errorMessage, writeException);
    }

    private async Task<PersistedRoomState> ReadPersistedRoomAsync(CancellationToken cancellationToken)
    {
        await using var context = await contextFactory.CreateDbContextAsync(cancellationToken);
        var roomExists = await context.Rooms
            .AsNoTracking()
            .AnyAsync(room => room.RoomId == CollaborationProtocol.RoomId, cancellationToken);
        var records = roomExists
            ? await context.RoomEntities
                .AsNoTracking()
                .Where(entity => entity.RoomId == CollaborationProtocol.RoomId)
                .ToListAsync(cancellationToken)
            : [];
        return new PersistedRoomState(roomExists, records.Select(ToDto).ToArray());
    }

    private void ApplyPersistedState(PersistedRoomState persistedState)
    {
        store.InitializeFromPersistence(persistedState.Entities, persistedState.RoomExists);
        ReplacePersistedEntities(persistedState.Entities);
    }

    private void MarkStateUncertain(string? entityId = null)
    {
        lock (_reconciliationSync)
        {
            _isReady = false;
            if (entityId is not null)
            {
                _pendingEntityReconciliations.Add(entityId);
            }

            if (_reconciliationTask is null || _reconciliationTask.IsCompleted)
            {
                _reconciliationTask = ReconcileUntilReadyAsync(_stoppingToken);
            }
        }
    }

    private async Task ReconcileUntilReadyAsync(CancellationToken cancellationToken)
    {
        var failureReported = false;
        while (!cancellationToken.IsCancellationRequested && !_isReady)
        {
            try
            {
                await ReconcileFromDatabaseAsync(cancellationToken);
                logger.LogInformation(
                    "A sala foi reconciliada com o banco e as alterações autoritativas foram propagadas.");
                lock (_reconciliationSync)
                {
                    if (_isReady)
                    {
                        _reconciliationTask = null;
                        return;
                    }
                }
            }
            catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
            {
                return;
            }
            catch (Exception exception)
            {
                if (!failureReported)
                {
                    if (IsTransientDatabaseFailure(exception))
                    {
                        logger.LogWarning(
                            exception,
                            "A verificação do banco continua temporariamente indisponível. A sala permanecerá bloqueada enquanto a reconciliação é repetida.");
                    }
                    else
                    {
                        logger.LogCritical(
                            exception,
                            "Não foi possível reconciliar a sala após um resultado de gravação incerto. A sala permanecerá indisponível até a recuperação.");
                    }
                    failureReported = true;
                }

                try
                {
                    await Task.Delay(_recoveryInterval, cancellationToken);
                }
                catch (OperationCanceledException) when (cancellationToken.IsCancellationRequested)
                {
                    return;
                }
            }
        }

    }

    private sealed record PersistedRoomState(bool RoomExists, EntityDto[] Entities);

    private static bool IsTransientDatabaseFailure(Exception exception)
    {
        var pending = new Stack<Exception>();
        pending.Push(exception);
        while (pending.TryPop(out var current))
        {
            if (current is SqlException { IsTransient: true } or TimeoutException)
            {
                return true;
            }

            if (current is AggregateException aggregate)
            {
                foreach (var innerException in aggregate.InnerExceptions)
                {
                    pending.Push(innerException);
                }
            }
            else if (current.InnerException is not null)
            {
                pending.Push(current.InnerException);
            }
        }

        return false;
    }

    public async Task<RoomSnapshotDto> JoinAsync(
        string connectionId,
        string displayName,
        int protocolVersion,
        IReadOnlyCollection<EntityDto> initialEntities)
    {
        await _writeLock.WaitAsync();
        try
        {
            EnsureReady();
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
            catch (Exception writeException)
            {
                await ResolveInitialRoomWriteAsync(
                    snapshot.Entities,
                    writeException,
                    "Não foi possível salvar o cenário inicial.");
                return snapshot;
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
            EnsureReady();
            var created = store.CreateEntity(connectionId, entity);
            try
            {
                await SaveEntityAsync(created.Id, created);
                _persistedEntities.Add(created.Id, created);
                return created;
            }
            catch (Exception writeException)
            {
                await ResolveEntityWriteAsync(
                    created.Id,
                    created,
                    writeException,
                    "Não foi possível persistir a criação do objeto.");
                return created;
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
            EnsureReady();
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
            catch (Exception writeException)
            {
                await ResolveEntityWriteAsync(
                    updated.Id,
                    updated,
                    writeException,
                    "Não foi possível persistir a edição do objeto.");
                return updated;
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
            EnsureReady();
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
            catch (Exception writeException)
            {
                await ResolveEntityWriteAsync(
                    entityId,
                    null,
                    writeException,
                    "Não foi possível persistir a exclusão do objeto.");
                _persistedEntities.Remove(entityId);
                store.ReleaseLock(connectionId, entityId);
                return true;
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
        context.Rooms.Add(new RoomRecord
        {
            RoomId = CollaborationProtocol.RoomId,
            UpdatedAtUtc = DateTime.UtcNow
        });
        context.RoomEntities.AddRange(entities.Select(ToRecord));
        await context.SaveChangesAsync();
    }

    private async Task SaveEntityAsync(string entityId, EntityDto? entity)
    {
        await using var context = await contextFactory.CreateDbContextAsync();
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

    private void EnsureReady()
    {
        if (!_isReady)
        {
            throw new RoomPersistenceException(
                "A sala ainda está carregando os dados persistidos. Tente novamente em instantes.",
                new InvalidOperationException("A inicialização da persistência ainda não foi concluída."));
        }
    }

    private RoomPersistenceException CreatePersistenceException(
        string message,
        Exception exception,
        bool requiresReconciliation = false)
    {
        logger.LogError(exception, "{PersistenceError}", message);
        return new RoomPersistenceException(message, exception, requiresReconciliation);
    }
}

public sealed class RoomPersistenceException(
    string message,
    Exception innerException,
    bool requiresReconciliation = false) : Exception(message, innerException)
{
    public bool RequiresReconciliation { get; } = requiresReconciliation;
}
