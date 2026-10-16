namespace Laboratorio.Collaboration.Contracts;

public sealed record Vector3Dto(double X, double Y, double Z);

public sealed record AnimationDto(bool Enabled, string Axis, double Speed);

public sealed record EntityDto(
    string Id,
    string Name,
    string Type,
    string Color,
    string MaterialMode,
    Vector3Dto Position,
    Vector3Dto Rotation,
    Vector3Dto Scale,
    AnimationDto Animation,
    string? LastEditor = null);

public sealed record ParticipantDto(string Id, string Name);

public sealed record EditLockDto(string EntityId, string ParticipantId, string ParticipantName);

public sealed record RoomSnapshotDto(
    int ProtocolVersion,
    string RoomId,
    IReadOnlyCollection<EntityDto> Entities,
    IReadOnlyCollection<ParticipantDto> Participants,
    IReadOnlyCollection<EditLockDto> Locks);

public sealed record LockResultDto(bool Granted, string? OwnerName = null, string? Reason = null);

public static class CollaborationProtocol
{
    public const int Version = 1;
    public const string RoomId = "laboratorio-principal";
}
