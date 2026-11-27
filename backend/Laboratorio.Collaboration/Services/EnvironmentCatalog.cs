using System.Text.Json;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class EnvironmentCatalog
{
    internal sealed record Preset(string Id, bool ReplaceOnly, EntityDto[] Objects,
        Dictionary<string, JsonElement>? Lighting, JsonElement[]? Particles);
    private sealed record Catalog(int Version, Preset[] Environments);
    private static readonly Catalog Data = Load();

    private static Catalog Load()
    {
        using var stream = typeof(EnvironmentCatalog).Assembly.GetManifestResourceStream("EnvironmentCatalog.json")!;
        return JsonSerializer.Deserialize<Catalog>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))!;
    }

    public static Preset Get(EnvironmentCommandDto command)
    {
        if (command is null || command.OperationId == Guid.Empty || command.Mode is not ("add" or "replace") ||
            command.CatalogVersion != Data.Version)
            throw new InvalidOperationException("Comando de ambiente inválido ou catálogo incompatível.");
        var preset = Data.Environments.SingleOrDefault(item => item.Id == command.EnvironmentId);
        if (preset is null || (preset.ReplaceOnly && command.Mode != "replace"))
            throw new InvalidOperationException("Ambiente ou modo de aplicação indisponível.");
        return preset;
    }
}
