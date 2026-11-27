using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class TrajectorySettings
{
    private static readonly Vector3Dto[] DefaultPoints =
    [
        new(-1, 0, 0), new(-0.5, 0.5, 1), new(0.5, 0.5, -1), new(1, 0, 0)
    ];

    public static TrajectoryDto? Normalize(TrajectoryDto? input)
    {
        if (input is null) return null;
        if (input.Type is not ("circle" or "ellipse" or "helix" or "bezier" or "catmull") ||
            input.Mode is not ("once" or "loop" or "pingpong") || input.Plane is not ("xy" or "xz" or "yz") ||
            !Within(input.Duration, 0.5, 120) || !Within(input.Radius, 0.05, 8) ||
            !Within(input.RadiusB, 0.05, 8) || !Within(input.Height, -8, 8) || input.Turns is < 1 or > 8)
        {
            throw new InvalidOperationException("Parâmetros da trajetória inválidos.");
        }

        var spline = input.Type is "bezier" or "catmull";
        var points = spline ? input.Points ?? DefaultPoints : input.Points;
        if (points is not null && (points.Length is < 2 or > 8 ||
            (input.Type == "bezier" && points.Length != 4) || points.Any(point => point is null ||
                !Within(point.X, -8, 8) || !Within(point.Y, -8, 8) || !Within(point.Z, -8, 8))))
        {
            throw new InvalidOperationException("Pontos de controle inválidos.");
        }
        if (spline && points is not null && !points.Any(point =>
            {
                var dx = point.X - points[0].X;
                var dy = point.Y - points[0].Y;
                var dz = point.Z - points[0].Z;
                return Math.Sqrt(dx * dx + dy * dy + dz * dz) >= 1e-4;
            }))
        {
            throw new InvalidOperationException("A trajetória precisa de pelo menos duas posições distintas.");
        }
        return input with { Points = spline ? points?.ToArray() : null };
    }

    private static bool Within(double value, double min, double max) => double.IsFinite(value) && value >= min && value <= max;

    public static void ValidateBounds(TrajectoryDto? settings, Vector3Dto position,
        (double X, double Y, double Z) extents, double? radius, double limit, double height, double epsilon)
    {
        if (settings?.Enabled != true) return;
        CheckAxis('x', position.X, radius ?? extents.X, -limit, limit);
        CheckAxis('y', position.Y, radius ?? extents.Y, 0, height);
        CheckAxis('z', position.Z, radius ?? extents.Z, -limit, limit);

        void CheckAxis(char axis, double center, double extent, double low, double high)
        {
            var (min, max) = GetAxisBounds(settings, axis);
            if (center + min - extent < low - epsilon || center + max + extent > high + epsilon)
                throw new InvalidOperationException("A trajetória completa, incluindo as dimensões do objeto, ultrapassa os limites da cena.");
        }
    }

    private static (double Min, double Max) GetAxisBounds(TrajectoryDto settings, char axis)
    {
        if (settings.Points is not { } points)
        {
            var planeIndex = settings.Plane.IndexOf(axis);
            if (planeIndex < 0)
            {
                var rise = settings.Type == "helix" ? settings.Height : 0;
                return (Math.Min(0, rise), Math.Max(0, rise));
            }
            var reach = planeIndex == 1 && settings.Type == "ellipse" ? settings.RadiusB : settings.Radius;
            return (-reach, reach);
        }

        var values = points.Select(point => axis switch { 'x' => point.X, 'y' => point.Y, _ => point.Z }).ToArray();
        var min = values.Min();
        var max = values.Max();
        if (settings.Type == "catmull")
        {
            for (var i = 0; i < values.Length - 1; i++)
            {
                var a = values[i];
                var b = values[i + 1];
                var previous = i > 0 ? values[i - 1] : 2 * a - b;
                var next = i + 2 < values.Length ? values[i + 2] : 2 * b - a;
                var first = a + (b - previous) / 6;
                var second = b - (next - a) / 6;
                min = Math.Min(min, Math.Min(first, second));
                max = Math.Max(max, Math.Max(first, second));
            }
        }
        return (min, max);
    }
}
