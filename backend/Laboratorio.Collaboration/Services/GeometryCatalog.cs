using System.Text.Json;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class GeometryCatalog
{
    private sealed record Shape(Dictionary<string, double[]> Parameters, ModelingGeometry.Catalog? Modeling);

    // The same channel ceilings are used by the Three.js factories. The test suite
    // checks each shape at its maximum subdivision against the mesh budget.
    private static readonly Dictionary<string, Shape> Shapes = LoadShapes();

    private static Dictionary<string, Shape> LoadShapes()
    {
        using var stream = typeof(GeometryCatalog).Assembly.GetManifestResourceStream("GeometryCatalog.json")
            ?? throw new InvalidOperationException("Catálogo de geometrias indisponível.");
        return JsonSerializer.Deserialize<Dictionary<string, Shape>>(
            stream, new JsonSerializerOptions { PropertyNameCaseInsensitive = true })
            ?? throw new InvalidOperationException("Catálogo de geometrias inválido.");
    }

    public static (GeometryParametersDto? Overrides, (double X, double Y, double Z) HalfSize) Describe(
        string type, GeometryParametersDto? input)
    {
        if (type is null || !Shapes.TryGetValue(type, out var shape))
            throw new InvalidOperationException("Tipo de geometria inválido.");
        var maxFields = shape.Parameters.Count + (shape.Modeling is null ? 0 : 1 + 2 * shape.Modeling.MaxPoints);
        if (input is not null && (input.Count > maxFields ||
            (shape.Modeling is null && input.Keys.Any(key => !shape.Parameters.ContainsKey(key)))))
            throw new InvalidOperationException("A forma recebeu parâmetros incompatíveis.");

        var resolved = new Dictionary<string, double>(shape.Parameters.Count);
        var overrides = new GeometryParametersDto();
        foreach (var (key, limits) in shape.Parameters)
        {
            var value = input is not null && input.TryGetValue(key, out var supplied) ? supplied : limits[0];
            if (!double.IsFinite(value) || value < limits[1] || value > limits[2] ||
                (limits[3] == 1 && value != Math.Truncate(value)))
                throw new InvalidOperationException($"Valor inválido para o parâmetro {key}.");
            resolved.Add(key, value);
            if (value != limits[0]) overrides.Add(key, value);
        }

        var halfSize = shape.Modeling is null
            ? HalfSize(type, resolved)
            : ModelingGeometry.Describe(type, shape.Modeling, resolved, input, overrides);
        return (overrides.Count == 0 ? null : overrides, halfSize);
    }

    private static (double X, double Y, double Z) HalfSize(string type, Dictionary<string, double> p) => type switch
    {
        "box" => (p["width"] / 2, p["height"] / 2, p["depth"] / 2),
        "plane" => (p["width"] / 2, p["height"] / 2, 0),
        "pyramid" or "cone" => Radial(p["radius"], p["height"] / 2),
        "cylinder" => Radial(Math.Max(p["radiusTop"], p["radiusBottom"]), p["height"] / 2),
        "capsule" => Radial(p["radius"], p["length"] / 2 + p["radius"]),
        "torus" => (p["radius"] + p["tube"], p["radius"] + p["tube"], p["tube"]),
        "torusKnot" => (1.5 * p["radius"] + p["tube"], 1.5 * p["radius"] + p["tube"], p["radius"] / 2 + p["tube"]),
        _ => Radial(p["radius"], p["radius"])
    };

    private static (double X, double Y, double Z) Radial(double radius, double halfHeight) =>
        (radius, halfHeight, radius);
}
