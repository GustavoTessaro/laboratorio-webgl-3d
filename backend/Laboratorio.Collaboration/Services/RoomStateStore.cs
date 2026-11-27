using System.Text.RegularExpressions;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

public sealed class RoomStateStore
{
    private static readonly TimeSpan LockLease = TimeSpan.FromSeconds(20);
    private const int MaximumEntities = 100;
    private const int MaximumNameLength = 32;
    private const double WorkspaceLimit = 10;
    private const double WorkspaceHeight = 10;
    private const double BoundsEpsilon = 1e-6;

    private readonly object _sync = new();
    private readonly Dictionary<string, EntityDto> _entities = new(StringComparer.Ordinal);
    private readonly Dictionary<string, ParticipantDto> _participants = new(StringComparer.Ordinal);
    private readonly Dictionary<string, EntityLock> _locks = new(StringComparer.Ordinal);
    private readonly TimeProvider _timeProvider;
    private bool _initialized;
    private bool _replacingEnvironment;
    private RoomLightingDto _lighting = LightingSettings.Default;
    private RoomParticlesDto _particles = ParticleSettings.Default;

    public RoomStateStore() : this(TimeProvider.System)
    {
    }

    public RoomStateStore(TimeProvider timeProvider)
    {
        _timeProvider = timeProvider ?? throw new ArgumentNullException(nameof(timeProvider));
    }

    public bool IsInitialized
    {
        get
        {
            lock (_sync)
            {
                return _initialized;
            }
        }
    }

    public void InitializeFromPersistence(
        IEnumerable<EntityDto> entities, bool initialized, RoomLightingDto? lighting = null,
        RoomParticlesDto? particles = null)
    {
        ArgumentNullException.ThrowIfNull(entities);
        lock (_sync)
        {
            var restoredEntities = entities.Select(CanonicalizeEntity).ToArray();
            if (restoredEntities.Length > MaximumEntities ||
                restoredEntities.Select(entity => entity.Id).Distinct(StringComparer.Ordinal).Count() !=
                restoredEntities.Length)
            {
                throw new InvalidOperationException("O cenário persistido contém entidades inválidas.");
            }

            _entities.Clear();
            foreach (var entity in restoredEntities)
            {
                _entities.Add(entity.Id, entity);
            }

            _initialized = initialized;
            _lighting = lighting ?? LightingSettings.Default;
            _particles = particles ?? ParticleSettings.Default;
        }
    }

    public RoomLightingDto GetLighting(string? connectionId = null)
    {
        lock (_sync)
        {
            if (connectionId is not null) RequireParticipant(connectionId);
            return _lighting;
        }
    }

    internal void SetLighting(RoomLightingDto lighting)
    {
        lock (_sync) _lighting = lighting;
    }

    public RoomParticlesDto GetParticles(string? connectionId = null)
    {
        lock (_sync)
        {
            if (connectionId is not null) RequireParticipant(connectionId);
            return _particles;
        }
    }

    internal void SetParticles(RoomParticlesDto particles)
    {
        lock (_sync) _particles = particles;
    }

    public EntityDto? GetEntity(string entityId)
    {
        lock (_sync)
        {
            return _entities.GetValueOrDefault(entityId);
        }
    }

    public void RestoreEntity(string entityId, EntityDto? entity)
    {
        lock (_sync)
        {
            if (entity is null)
            {
                _entities.Remove(entityId);
                return;
            }

            var canonicalEntity = CanonicalizeEntity(entity);
            if (canonicalEntity.Id != entityId)
            {
                throw new InvalidOperationException("O ID restaurado não corresponde ao objeto.");
            }

            _entities[entityId] = canonicalEntity;
        }
    }

    public static string ValidateDisplayName(string? name)
    {
        var normalized = name?.Trim();
        if (string.IsNullOrWhiteSpace(normalized) || normalized.Length > MaximumNameLength)
        {
            throw new InvalidOperationException($"O nome deve ter entre 1 e {MaximumNameLength} caracteres.");
        }

        return normalized;
    }

    public RoomSnapshotDto Join(
        string connectionId,
        string displayName,
        int protocolVersion,
        IReadOnlyCollection<EntityDto> initialEntities)
    {
        if (protocolVersion != CollaborationProtocol.Version)
        {
            throw new InvalidOperationException("Versão de protocolo incompatível.");
        }

        lock (_sync)
        {
            if (!_initialized)
            {
                if (initialEntities.Count > MaximumEntities)
                {
                    throw new InvalidOperationException("O snapshot inicial excede o limite de objetos.");
                }

                var initialIds = new HashSet<string>(StringComparer.Ordinal);
                foreach (var entity in initialEntities)
                {
                    var canonicalEntity = CanonicalizeEntity(entity);
                    if (!initialIds.Add(canonicalEntity.Id))
                    {
                        throw new InvalidOperationException("O snapshot inicial contém IDs duplicados.");
                    }
                }

                foreach (var entity in initialEntities)
                {
                    var canonicalEntity = CanonicalizeEntity(entity);
                    _entities.Add(canonicalEntity.Id, canonicalEntity with { LastEditor = null });
                }
                _initialized = true;
            }

            _participants[connectionId] = new ParticipantDto(connectionId, ValidateDisplayName(displayName));
            return SnapshotUnsafe();
        }
    }

    public (ParticipantDto? Participant, IReadOnlyList<EditLockDto> ReleasedLocks) Leave(
        string connectionId, Action<string>? discardPreview = null)
    {
        lock (_sync)
        {
            var removed = _participants.Remove(connectionId, out var participant) ? participant : null;
            var releasedLocks = _locks
                         .Where(entry => entry.Value.ParticipantId == connectionId)
                         .Select(entry => new EditLockDto(
                             entry.Key,
                             entry.Value.ParticipantId,
                             entry.Value.ParticipantName))
                         .ToArray();
            foreach (var entityLock in releasedLocks)
            {
                if (_locks[entityLock.EntityId].HasPreview)
                    discardPreview?.Invoke(entityLock.EntityId);
                _locks.Remove(entityLock.EntityId);
            }

            return (removed, releasedLocks);
        }
    }

    public IReadOnlyList<EditLockDto> ExpireLocks(Action<string>? discardPreview = null)
    {
        lock (_sync)
        {
            return ExpireLocksUnsafe(discardPreview);
        }
    }

    public LockResultDto AcquireLock(string connectionId, string entityId, Action<string>? discardPreview = null)
    {
        lock (_sync)
        {
            if (_replacingEnvironment)
                return new LockResultDto(false, Reason: "A substituição da cena está em andamento.");
            if (!_participants.TryGetValue(connectionId, out var participant))
            {
                return new LockResultDto(false, Reason: "Entre na sala antes de editar.");
            }

            if (!_entities.ContainsKey(entityId))
            {
                return new LockResultDto(false, Reason: "O objeto não existe mais na sala.");
            }

            var now = _timeProvider.GetUtcNow();
            if (_locks.TryGetValue(entityId, out var existing) &&
                existing.ExpiresAt > now &&
                existing.ParticipantId != connectionId)
            {
                return new LockResultDto(false, existing.ParticipantName, "Objeto bloqueado por outro participante.");
            }

            _locks[entityId] = new EntityLock(
                connectionId,
                participant.Name,
                now + LockLease,
                existing is { HasPreview: true } && existing.ParticipantId == connectionId &&
                existing.ExpiresAt > now);
            if (existing is { HasPreview: true } && !_locks[entityId].HasPreview)
                discardPreview?.Invoke(entityId);
            return new LockResultDto(true);
        }
    }

    public bool RenewLock(string connectionId, string entityId)
    {
        lock (_sync)
        {
            if (!_locks.TryGetValue(entityId, out var entityLock) ||
                entityLock.ParticipantId != connectionId ||
                entityLock.ExpiresAt <= _timeProvider.GetUtcNow())
            {
                return false;
            }

            _locks[entityId] = entityLock with { ExpiresAt = _timeProvider.GetUtcNow() + LockLease };
            return true;
        }
    }

    public EditLockDto? GetLock(string entityId)
    {
        lock (_sync)
        {
            return _locks.TryGetValue(entityId, out var entityLock) &&
                   entityLock.ExpiresAt > _timeProvider.GetUtcNow()
                ? new EditLockDto(entityId, entityLock.ParticipantId, entityLock.ParticipantName)
                : null;
        }
    }

    public bool ReleaseLock(string connectionId, string entityId, Action<string>? discardPreview = null)
    {
        lock (_sync)
        {
            if (!_locks.TryGetValue(entityId, out var entityLock) || entityLock.ParticipantId != connectionId)
                return false;
            if (entityLock.HasPreview)
                discardPreview?.Invoke(entityId);
            return _locks.Remove(entityId);
        }
    }

    public EntityDto CreateEntity(string connectionId, EntityDto entity)
    {
        entity = CanonicalizeEntity(entity);
        lock (_sync)
        {
            RequireParticipant(connectionId);
            if (_entities.Count >= MaximumEntities)
            {
                throw new InvalidOperationException("A sala atingiu o limite de objetos.");
            }

            if (_entities.ContainsKey(entity.Id))
            {
                throw new InvalidOperationException("Já existe um objeto com esse ID.");
            }

            var stored = entity with { LastEditor = _participants[connectionId].Name };
            _entities.Add(stored.Id, stored);
            return stored;
        }
    }

    public EntityDto UpdateEntity(string connectionId, EntityDto entity, bool final = true)
    {
        entity = CanonicalizeEntity(entity);
        lock (_sync)
        {
            RequireLockOwner(connectionId, entity.Id);
            var committed = _entities[entity.Id];
            if (!final)
            {
                if (entity.Trajectory != committed.Trajectory)
                    throw new InvalidOperationException("Alterações de trajetória precisam de confirmação final.");
                _locks[entity.Id] = _locks[entity.Id] with { HasPreview = true };
                return entity with { LastEditor = committed.LastEditor };
            }

            _locks[entity.Id] = _locks[entity.Id] with { HasPreview = false };
            if ((entity with { LastEditor = committed.LastEditor }) == committed)
                return committed;
            var stored = entity with { LastEditor = _participants[connectionId].Name };
            _entities[stored.Id] = stored;
            return stored;
        }
    }

    public bool DeleteEntity(string connectionId, string entityId, bool releaseLock = true)
    {
        lock (_sync)
        {
            RequireLockOwner(connectionId, entityId);
            if (releaseLock)
            {
                _locks.Remove(entityId);
            }

            return _entities.Remove(entityId);
        }
    }

    public RoomSnapshotDto GetSnapshot()
    {
        lock (_sync)
        {
            return SnapshotUnsafe();
        }
    }

    public static void ValidateEntity(EntityDto entity) => CanonicalizeEntity(entity);

    internal EnvironmentChangeDto PrepareEnvironment(string connectionId, EnvironmentCommandDto command,
        EnvironmentCatalog.Preset preset)
    {
        lock (_sync)
        {
            RequireParticipant(connectionId);
            var replace = command.Mode == "replace";
            if (replace && _locks.Values.Any(item => item.ExpiresAt > _timeProvider.GetUtcNow()))
                throw new InvalidOperationException("Conclua as edições bloqueadas antes de substituir a cena.");
            if ((replace ? 0 : _entities.Count) + preset.Objects.Length > MaximumEntities)
                throw new InvalidOperationException($"Limite de {MaximumEntities} objetos por sala.");

            var ids = _entities.Keys.ToHashSet();
            ids.UnionWith(_particles.Effects.EnumerateObject().Select(effect => effect.Name));
            var objects = preset.Objects.Select(template =>
            {
                string id;
                do { id = Guid.NewGuid().ToString(); } while (!ids.Add(id));
                return CanonicalizeEntity(template with { Id = id, LastEditor = _participants[connectionId].Name });
            }).ToArray();
            var lighting = replace ? LightingSettings.Default.Settings : _lighting.Settings;
            var effects = replace ? ParticleSettings.Default.Effects : _particles.Effects;
            if (replace && preset.Lighting is not null)
                foreach (var (group, patch) in preset.Lighting)
                    lighting = LightingSettings.Apply(lighting, group, patch);
            foreach (var patch in preset.Particles ?? [])
            {
                string id;
                do { id = Guid.NewGuid().ToString(); } while (!ids.Add(id));
                effects = ParticleSettings.Apply(effects, new ParticleCommandDto("add", id, patch));
            }
            var nextLighting = System.Text.Json.JsonElement.DeepEquals(lighting, _lighting.Settings)
                ? _lighting : new RoomLightingDto(checked(_lighting.Revision + 1), lighting);
            var nextParticles = System.Text.Json.JsonElement.DeepEquals(effects, _particles.Effects)
                ? _particles : new RoomParticlesDto(checked(_particles.Revision + 1), effects);
            _replacingEnvironment = replace;
            return new EnvironmentChangeDto(command.OperationId, command.Mode, objects, nextLighting, nextParticles);
        }
    }

    internal void CompleteEnvironment(EnvironmentChangeDto change)
    {
        lock (_sync)
        {
            if (change.Mode == "replace")
            {
                _locks.Clear();
                _entities.Clear();
            }
            foreach (var entity in change.Entities) _entities.Add(entity.Id, entity);
            _lighting = change.Lighting;
            _particles = change.Particles;
        }
    }

    internal void EndEnvironment()
    {
        lock (_sync) _replacingEnvironment = false;
    }

    private static (GeometryParametersDto? Geometry, TrajectoryDto? Trajectory) ValidateSpatialSettings(EntityDto entity)
    {
        if (entity is null ||
            entity.Position is null ||
            entity.Rotation is null ||
            entity.Scale is null ||
            entity.Animation is null)
        {
            throw new InvalidOperationException("O objeto contém dados incompletos.");
        }

        if (!Guid.TryParse(entity.Id, out _))
        {
            throw new InvalidOperationException("ID de objeto inválido.");
        }

        if (string.IsNullOrWhiteSpace(entity.Name) || entity.Name.Length > 64)
        {
            throw new InvalidOperationException("Nome de objeto inválido.");
        }

        var (geometryParameters, halfSize) = GeometryCatalog.Describe(entity.Type, entity.GeometryParameters);

        if (entity.Color is null ||
            !Regex.IsMatch(entity.Color, "^#[0-9a-fA-F]{6}$", RegexOptions.CultureInvariant))
        {
            throw new InvalidOperationException("Cor inválida.");
        }

        if (entity.MaterialMode is not ("solid" or "wireframe"))
        {
            throw new InvalidOperationException("Modo de material inválido.");
        }

        ValidateVector(entity.Position, "posição");
        ValidateVector(entity.Rotation, "rotação");
        ValidateVector(entity.Scale, "escala");
        if (!IsFinite(entity.Animation.Speed) || entity.Animation.Speed is < 0 or > 360)
        {
            throw new InvalidOperationException("Velocidade de animação inválida.");
        }

        if (entity.Animation.Axis is not ("x" or "y" or "z"))
        {
            throw new InvalidOperationException("Eixo de animação inválido.");
        }

        if (new[] { entity.Scale.X, entity.Scale.Y, entity.Scale.Z }
            .Any(scale => scale is < 0.2 or > 3))
        {
            throw new InvalidOperationException("A escala deve estar entre 0,2 e 3,0.");
        }

        var extents = GetWorldExtents(entity.Rotation, entity.Scale, halfSize);
        if (entity.Position.X - extents.X < -WorkspaceLimit - BoundsEpsilon ||
            entity.Position.X + extents.X > WorkspaceLimit + BoundsEpsilon ||
            entity.Position.Y - extents.Y < -BoundsEpsilon ||
            entity.Position.Y + extents.Y > WorkspaceHeight + BoundsEpsilon ||
            entity.Position.Z - extents.Z < -WorkspaceLimit - BoundsEpsilon ||
            entity.Position.Z + extents.Z > WorkspaceLimit + BoundsEpsilon)
        {
            throw new InvalidOperationException("A transformação ultrapassa os limites do cenário.");
        }
        var trajectory = TrajectorySettings.Normalize(entity.Trajectory);
        var sx = halfSize.X * entity.Scale.X;
        var sy = halfSize.Y * entity.Scale.Y;
        var sz = halfSize.Z * entity.Scale.Z;
        var radius = Math.Sqrt(sx * sx + sy * sy + sz * sz);
        TrajectorySettings.ValidateBounds(trajectory, entity.Position, extents,
            entity.Animation.Enabled || trajectory?.Orient == true ? radius : null,
            WorkspaceLimit, WorkspaceHeight, BoundsEpsilon);
        return (geometryParameters, trajectory);
    }

    private static (double X, double Y, double Z) GetWorldExtents(
        Vector3Dto rotation,
        Vector3Dto scale,
        (double X, double Y, double Z) halfSize)
    {
        var (sx, sy, sz) = scale;
        var (x, y, z) = rotation;
        var cx = Math.Cos(x);
        var sxr = Math.Sin(x);
        var cy = Math.Cos(y);
        var syr = Math.Sin(y);
        var cz = Math.Cos(z);
        var szr = Math.Sin(z);

        var m11 = cy * cz;
        var m12 = -cy * szr;
        var m13 = syr;
        var m21 = cx * szr + sxr * syr * cz;
        var m22 = cx * cz - sxr * syr * szr;
        var m23 = -sxr * cy;
        var m31 = sxr * szr - cx * syr * cz;
        var m32 = sxr * cz + cx * syr * szr;
        var m33 = cx * cy;

        return (
            Math.Abs(m11) * halfSize.X * sx + Math.Abs(m12) * halfSize.Y * sy + Math.Abs(m13) * halfSize.Z * sz,
            Math.Abs(m21) * halfSize.X * sx + Math.Abs(m22) * halfSize.Y * sy + Math.Abs(m23) * halfSize.Z * sz,
            Math.Abs(m31) * halfSize.X * sx + Math.Abs(m32) * halfSize.Y * sy + Math.Abs(m33) * halfSize.Z * sz);
    }

    private static void ValidateVector(Vector3Dto vector, string label)
    {
        if (!IsFinite(vector.X) || !IsFinite(vector.Y) || !IsFinite(vector.Z))
        {
            throw new InvalidOperationException($"A {label} contém valores não finitos.");
        }
    }

    private static bool IsFinite(double value) => !double.IsNaN(value) && !double.IsInfinity(value);

    private static EntityDto CanonicalizeEntity(EntityDto entity)
    {
        var (geometry, trajectory) = ValidateSpatialSettings(entity);
        return entity with
        {
            Id = Guid.Parse(entity.Id).ToString(),
            GeometryParameters = geometry,
            Trajectory = trajectory,
            MaterialSettings = MaterialSettings.Normalize(entity.MaterialSettings)
        };
    }

    private void RequireParticipant(string connectionId)
    {
        if (!_participants.ContainsKey(connectionId))
        {
            throw new InvalidOperationException("Entre na sala antes de alterar objetos.");
        }
    }

    private void RequireLockOwner(string connectionId, string entityId)
    {
        RequireParticipant(connectionId);
        if (!_locks.TryGetValue(entityId, out var entityLock) ||
            entityLock.ParticipantId != connectionId ||
            entityLock.ExpiresAt <= _timeProvider.GetUtcNow())
        {
            throw new InvalidOperationException("É necessário possuir o bloqueio do objeto para alterá-lo.");
        }
    }

    private RoomSnapshotDto SnapshotUnsafe()
    {
        return new RoomSnapshotDto(
            CollaborationProtocol.Version,
            CollaborationProtocol.RoomId,
            _entities.Values.ToArray(),
            _participants.Values.ToArray(),
            _locks.Where(entry => entry.Value.ExpiresAt > _timeProvider.GetUtcNow()).Select(entry => new EditLockDto(
                entry.Key,
                entry.Value.ParticipantId,
                entry.Value.ParticipantName)).ToArray(),
            _lighting, _particles);
    }

    private IReadOnlyList<EditLockDto> ExpireLocksUnsafe(Action<string>? discardPreview)
    {
        var now = _timeProvider.GetUtcNow();
        var expired = _locks
            .Where(entry => entry.Value.ExpiresAt <= now)
            .Select(entry => new EditLockDto(entry.Key, entry.Value.ParticipantId, entry.Value.ParticipantName))
            .ToArray();
        foreach (var entityLock in expired)
        {
            if (_locks[entityLock.EntityId].HasPreview)
                discardPreview?.Invoke(entityLock.EntityId);
            _locks.Remove(entityLock.EntityId);
        }

        return expired;
    }

    private sealed record EntityLock(
        string ParticipantId, string ParticipantName, DateTimeOffset ExpiresAt, bool HasPreview);
}
