using System.Text.Json;
using System.Text.Json.Serialization;

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
    string? LastEditor = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    GeometryParametersDto? GeometryParameters = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    MaterialSettingsDto? MaterialSettings = null,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)]
    TrajectoryDto? Trajectory = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record TrajectoryDto(
    bool Enabled = false, string Type = "circle", double Duration = 6, bool Reverse = false,
    string Mode = "loop", string Plane = "xz", double Radius = 1, double RadiusB = 0.6,
    double Height = 2, int Turns = 2, bool Orient = false, Vector3Dto[]? Points = null)
{
    public bool Equals(TrajectoryDto? other) =>
        other is not null && Enabled == other.Enabled && Type == other.Type && Duration == other.Duration &&
        Reverse == other.Reverse && Mode == other.Mode && Plane == other.Plane &&
        Radius == other.Radius && RadiusB == other.RadiusB && Height == other.Height &&
        Turns == other.Turns && Orient == other.Orient &&
        (Points is null ? other.Points is null : other.Points is not null && Points.SequenceEqual(other.Points));

    public override int GetHashCode()
    {
        var hash = new HashCode();
        hash.Add(HashCode.Combine(Enabled, Type, Duration, Reverse, Mode, Plane));
        hash.Add(HashCode.Combine(Radius, RadiusB, Height, Turns, Orient));
        if (Points is not null)
            foreach (var point in Points) hash.Add(point);
        return hash.ToHashCode();
    }
}

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record MaterialSettingsDto(
    string Kind = "standard",
    double Opacity = 1,
    bool Transparent = false,
    string Side = "front",
    double Roughness = 0.38,
    double Metalness = 0.12,
    double Shininess = 30,
    string Specular = "#111111",
    string Emissive = "#000000",
    double EmissiveIntensity = 1,
    string? TextureId = null,
    double RepeatU = 1,
    double RepeatV = 1,
    double OffsetU = 0,
    double OffsetV = 0,
    double TextureRotation = 0,
    [property: JsonIgnore(Condition = JsonIgnoreCondition.WhenWritingNull)] ShaderDescriptorDto? Shader = null);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ShaderDescriptorDto(string Id, ShaderParameterValues? Parameters = null);

public sealed class ShaderParameterValues : Dictionary<string, JsonElement>, IEquatable<ShaderParameterValues>
{
    public bool Equals(ShaderParameterValues? other) => other is not null && Count == other.Count &&
        this.All(pair => other.TryGetValue(pair.Key, out var value) && JsonElement.DeepEquals(pair.Value, value));
    public override bool Equals(object? obj) => obj is ShaderParameterValues other && Equals(other);
    public override int GetHashCode() => Count;
}

public sealed class GeometryParametersDto : Dictionary<string, double>, IEquatable<GeometryParametersDto>
{
    public bool Equals(GeometryParametersDto? other) =>
        other is not null && Count == other.Count &&
        this.All(parameter => other.TryGetValue(parameter.Key, out var value) && value == parameter.Value);

    public override bool Equals(object? obj) => obj is GeometryParametersDto other && Equals(other);

    public override int GetHashCode()
    {
        var hash = new HashCode();
        foreach (var parameter in this.OrderBy(parameter => parameter.Key, StringComparer.Ordinal))
            hash.Add(parameter);
        return hash.ToHashCode();
    }
}

public sealed record ParticipantDto(string Id, string Name);

public sealed record EditLockDto(string EntityId, string ParticipantId, string ParticipantName);

public sealed record RoomLightingDto(long Revision, JsonElement Settings);
public sealed record RoomParticlesDto(long Revision, JsonElement Effects);

[JsonUnmappedMemberHandling(JsonUnmappedMemberHandling.Disallow)]
public sealed record ParticleCommandDto(string Operation, string Id, JsonElement? Patch = null);

public sealed record RoomSnapshotDto(
    int ProtocolVersion,
    string RoomId,
    IReadOnlyCollection<EntityDto> Entities,
    IReadOnlyCollection<ParticipantDto> Participants,
    IReadOnlyCollection<EditLockDto> Locks,
    RoomLightingDto Lighting,
    RoomParticlesDto Particles);

public sealed record LockResultDto(bool Granted, string? OwnerName = null, string? Reason = null);

public sealed record EnvironmentCommandDto(string EnvironmentId, string Mode, Guid OperationId, int CatalogVersion);
public sealed record EnvironmentChangeDto(Guid OperationId, string Mode, EntityDto[] Entities,
    RoomLightingDto Lighting, RoomParticlesDto Particles);

public static class CollaborationProtocol
{
    public const int Version = 9;
    public const string RoomId = "laboratorio-principal";
}
