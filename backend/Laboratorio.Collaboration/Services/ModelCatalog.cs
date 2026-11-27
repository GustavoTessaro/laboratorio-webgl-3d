using System.Text.Json;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class ModelCatalog
{
    internal sealed record Entry(double[] HalfSize, int Vertices, int Triangles, int Pixels);
    private sealed record Limits(int SceneModels, int SceneVertices, int SceneTriangles, int ScenePixels);
    private sealed record Catalog(Limits Limits, Dictionary<string, Entry> Models);
    private static readonly Catalog Data = Load();

    private static Catalog Load()
    {
        using var stream = typeof(ModelCatalog).Assembly.GetManifestResourceStream("ModelCatalog.json")!;
        return JsonSerializer.Deserialize<Catalog>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    public static Entry? Find(string? type) => type is null ? null : Data.Models.GetValueOrDefault(type);

    public static void ValidateBudget(IEnumerable<EntityDto> entities)
    {
        var models = entities.Select(entity => Find(entity?.Type)).OfType<Entry>().ToArray();
        if (models.Length > Data.Limits.SceneModels || models.Sum(model => model.Vertices) > Data.Limits.SceneVertices ||
            models.Sum(model => model.Triangles) > Data.Limits.SceneTriangles ||
            models.Sum(model => model.Pixels) > Data.Limits.ScenePixels)
            throw new InvalidOperationException("O orçamento de modelos 3D da sala foi excedido.");
    }
}
