using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class EntityEditIntent
{
    public static EntityDto Merge(EntityDto before, EntityDto after, EntityDto confirmed, bool final)
    {
        var geometry = MergeGroup("geometria", (before.Type, before.Name, before.GeometryParameters),
            (after.Type, after.Name, after.GeometryParameters), (confirmed.Type, confirmed.Name, confirmed.GeometryParameters));
        return confirmed with
        {
            Type = geometry.Type,
            Name = geometry.Name,
            GeometryParameters = geometry.GeometryParameters,
            Position = MergeGroup("posição", before.Position, after.Position, confirmed.Position, true),
            Rotation = MergeGroup("rotação", before.Rotation, after.Rotation, confirmed.Rotation, true),
            Scale = MergeGroup("escala", before.Scale, after.Scale, confirmed.Scale, true),
            Color = MergeGroup("cor", before.Color, after.Color, confirmed.Color),
            MaterialMode = MergeGroup("modo de exibição", before.MaterialMode, after.MaterialMode, confirmed.MaterialMode),
            MaterialSettings = MergeGroup("material, textura ou shader", before.MaterialSettings, after.MaterialSettings, confirmed.MaterialSettings),
            Animation = MergeGroup("rotação automática", before.Animation, after.Animation, confirmed.Animation),
            Trajectory = MergeGroup("trajetória", before.Trajectory, after.Trajectory, confirmed.Trajectory)
        };

        T MergeGroup<T>(string label, T baseline, T requested, T current, bool transform = false)
        {
            var equal = EqualityComparer<T>.Default;
            if (equal.Equals(baseline, requested)) return current;
            if (!final && !transform)
                throw new InvalidOperationException("Somente transformações podem ser enviadas como prévia.");
            if (equal.Equals(current, baseline) || equal.Equals(current, requested)) return requested;
            throw new InvalidOperationException($"Conflito em {label}. A alteração confirmada por outro participante foi preservada.");
        }
    }
}
