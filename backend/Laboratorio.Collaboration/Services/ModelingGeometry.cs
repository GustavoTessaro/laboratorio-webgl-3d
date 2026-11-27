using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class ModelingGeometry
{
    internal sealed record Catalog(int MaxPoints, double CoordinateLimit, string DefaultPreset,
        Dictionary<string, Preset> Presets);
    internal sealed record Preset(double[][] Points);

    private readonly record struct Point(double X, double Y);
    private const int Ticks = 10000;
    private const double Epsilon = 1e-9;
    private const double MinArea = 0.005;
    private const double Rounding = 0.2;
    private const int VertexBudget = 8192;
    private const int TriangleBudget = 8192;

    public static (double X, double Y, double Z) Describe(
        string type, Catalog info, Dictionary<string, double> p, GeometryParametersDto? input,
        GeometryParametersDto overrides)
    {
        var defaults = info.Presets[info.DefaultPreset].Points.Select(pair => new Point(pair[0], pair[1])).ToArray();
        var points = defaults;
        var pointKeys = new HashSet<string>(StringComparer.Ordinal);
        var lathe = type == "lathe";
        if (input?.TryGetValue("pointCount", out var count) == true)
        {
            if (!double.IsFinite(count) || Math.Truncate(count) != count ||
                count < (lathe ? 2 : 3) || count > info.MaxPoints)
                throw new InvalidOperationException("Quantidade de pontos inválida.");
            pointKeys.Add("pointCount");
            points = new Point[(int)count];
            for (var i = 0; i < points.Length; i++)
                points[i] = new Point(ReadCoordinate($"x{i}"), ReadCoordinate($"y{i}"));
        }
        if (input is not null && input.Keys.Any(key => !p.ContainsKey(key) && !pointKeys.Contains(key)))
            throw new InvalidOperationException("O descritor deve informar a quantidade e os pares de coordenadas dos pontos.");
        if (!points.SequenceEqual(defaults) && input is not null)
            foreach (var key in pointKeys.Order(StringComparer.Ordinal)) overrides.Add(key, input[key]);

        return lathe ? LatheBounds(points, p["radialSegments"]) : ExtrudeBounds(points, p);

        double ReadCoordinate(string key)
        {
            pointKeys.Add(key);
            if (!input!.TryGetValue(key, out var value) || !double.IsFinite(value) ||
                Math.Truncate(value) != value || Math.Abs(value) > info.CoordinateLimit * Ticks)
                throw new InvalidOperationException("Cada ponto deve ter duas coordenadas válidas dentro dos limites.");
            return value / Ticks;
        }
    }

    private static (double X, double Y, double Z) LatheBounds(Point[] points, double segments)
    {
        var radius = points.Max(point => point.X);
        for (var i = 0; i < points.Length; i++)
        {
            if (radius < 0.05 || points[i].X < 0 || (i > 0 && points[i].Y - points[i - 1].Y < 0.01 - Epsilon) ||
                (i > 0 && i < points.Length - 1 && points[i].X < 0.01))
                throw new InvalidOperationException("Use alturas crescentes e raios positivos. Só as extremidades podem tocar o eixo.");
        }
        ValidateBudget((segments + 1) * points.Length, 2 * segments * (points.Length - 1));
        return (radius, (points[^1].Y - points[0].Y) / 2, radius);
    }

    private static (double X, double Y, double Z) ExtrudeBounds(Point[] points, Dictionary<string, double> p)
    {
        var rounded = p["rounded"] == 1;
        var bevel = p["bevelEnabled"] == 1;
        var steps = p["depthSegments"] + (bevel ? 2 * p["bevelSegments"] : 0);
        var count = points.Length * (rounded ? p["curveSegments"] + 1 : 1);
        var triangles = 2 * (count - 2) + 2 * count * steps;
        ValidateBudget(3 * triangles, triangles);
        ValidatePolygon(points, 0, 0.001);
        var outline = rounded ? RoundOutline(points, (int)p["curveSegments"]) : points;
        var expansion = bevel ? Math.Sqrt(2) * p["bevelSize"] : 0;
        if (rounded || bevel) ValidatePolygon(outline, 2 * expansion, 0.00001);
        return (
            (points.Max(point => point.X) - points.Min(point => point.X)) / 2 + expansion,
            (points.Max(point => point.Y) - points.Min(point => point.Y)) / 2 + expansion,
            p["depth"] / 2 + (bevel ? p["bevelThickness"] : 0));
    }

    private static void ValidateBudget(double vertices, double triangles)
    {
        if (vertices > VertexBudget || triangles > TriangleBudget)
            throw new InvalidOperationException("Reduza a quantidade de pontos ou segmentos para respeitar o orçamento da malha.");
    }

    private static Point[] RoundOutline(Point[] points, int segments)
    {
        var outline = new Point[points.Length * (segments + 1)];
        for (var i = 0; i < points.Length; i++)
        {
            var point = points[i];
            var start = Mix(point, points[(i + points.Length - 1) % points.Length]);
            var end = Mix(point, points[(i + 1) % points.Length]);
            for (var j = 0; j <= segments; j++)
            {
                var t = (double)j / segments;
                var s = 1 - t;
                outline[i * (segments + 1) + j] = new Point(
                    s * s * start.X + 2 * s * t * point.X + t * t * end.X,
                    s * s * start.Y + 2 * s * t * point.Y + t * t * end.Y);
            }
        }
        return outline;
    }

    private static Point Mix(Point a, Point b) => new(a.X + (b.X - a.X) * Rounding, a.Y + (b.Y - a.Y) * Rounding);
    private static double Cross(Point a, Point b, Point p) => (b.X - a.X) * (p.Y - a.Y) - (b.Y - a.Y) * (p.X - a.X);
    private static double Distance(Point a, Point b) => Length(a.X - b.X, a.Y - b.Y);
    private static double Length(double x, double y) => Math.Sqrt(x * x + y * y);

    private static bool OnSegment(Point a, Point b, Point p) => Math.Abs(Cross(a, b, p)) <= Epsilon &&
        p.X >= Math.Min(a.X, b.X) - Epsilon && p.X <= Math.Max(a.X, b.X) + Epsilon &&
        p.Y >= Math.Min(a.Y, b.Y) - Epsilon && p.Y <= Math.Max(a.Y, b.Y) + Epsilon;

    private static bool Opposite(double a, double b) => (a > Epsilon && b < -Epsilon) || (a < -Epsilon && b > Epsilon);

    private static bool Intersects(Point a, Point b, Point c, Point d) =>
        Opposite(Cross(a, b, c), Cross(a, b, d)) && Opposite(Cross(c, d, a), Cross(c, d, b)) ||
        OnSegment(a, b, c) || OnSegment(a, b, d) || OnSegment(c, d, a) || OnSegment(c, d, b);

    private static double PointSegmentDistance(Point p, Point a, Point b)
    {
        var dx = b.X - a.X;
        var dy = b.Y - a.Y;
        var denominator = dx * dx + dy * dy;
        if (denominator == 0) return Distance(p, a);
        var t = Math.Clamp(((p.X - a.X) * dx + (p.Y - a.Y) * dy) / denominator, 0, 1);
        return Length(p.X - a.X - t * dx, p.Y - a.Y - t * dy);
    }

    private static void ValidatePolygon(Point[] points, double clearance, double separation)
    {
        var n = points.Length;
        var twiceArea = 0.0;
        for (var i = 0; i < n; i++)
        {
            var a = points[i];
            var b = points[(i + 1) % n];
            var previous = points[(i + n - 1) % n];
            var length = Distance(a, b);
            var previousLength = Distance(a, previous);
            if (length < separation || previousLength < separation)
                throw new InvalidOperationException("O contorno contém pontos repetidos ou próximos demais.");
            twiceArea += a.X * b.Y - a.Y * b.X;
            var dot = (previous.X - a.X) * (b.X - a.X) + (previous.Y - a.Y) * (b.Y - a.Y);
            if (Math.Abs(Cross(previous, a, b)) <= Epsilon && dot > 0)
                throw new InvalidOperationException("O contorno contém arestas sobrepostas.");
            if (clearance > 0)
            {
                var sineHalf = Math.Sqrt(Math.Max(0, (1 - dot / (length * previousLength)) / 2));
                if (Math.Min(length, previousLength) * sineHalf <= clearance + Epsilon)
                    throw new InvalidOperationException("Reduza o tamanho do chanfro para manter folga entre as arestas.");
            }
            for (var j = i + 2; j < n; j++)
            {
                if (i == 0 && j == n - 1) continue;
                var c = points[j];
                var d = points[(j + 1) % n];
                if (Intersects(a, b, c, d))
                    throw new InvalidOperationException("O contorno não pode se cruzar nem tocar a si mesmo.");
                if (clearance > 0 && Math.Min(Math.Min(PointSegmentDistance(a, c, d), PointSegmentDistance(b, c, d)),
                    Math.Min(PointSegmentDistance(c, a, b), PointSegmentDistance(d, a, b))) <= clearance + Epsilon)
                    throw new InvalidOperationException("Reduza o tamanho do chanfro para manter folga no contorno.");
            }
        }
        if (Math.Abs(twiceArea) < 2 * MinArea)
            throw new InvalidOperationException("A área do contorno é insuficiente.");
    }
}
