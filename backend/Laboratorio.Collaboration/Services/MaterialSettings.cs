using System.Text.Json;
using System.Text.RegularExpressions;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class MaterialSettings
{
    private static readonly MaterialSettingsDto Defaults = new();
    private static readonly HashSet<string> TextureIds = LoadTextureIds();

    private static HashSet<string> LoadTextureIds()
    {
        using var stream = typeof(MaterialSettings).Assembly.GetManifestResourceStream("TextureCatalog.json")
            ?? throw new InvalidOperationException("Catálogo de texturas indisponível.");
        using var catalog = JsonDocument.Parse(stream);
        return catalog.RootElement.EnumerateObject().Select(item => item.Name).ToHashSet(StringComparer.Ordinal);
    }

    public static MaterialSettingsDto? Normalize(MaterialSettingsDto? settings)
    {
        if (settings is null) return null;
        if (settings.Kind is not ("basic" or "phong" or "standard") ||
            settings.Side is not ("front" or "back" or "double") ||
            (settings.TextureId is not null && !TextureIds.Contains(settings.TextureId)))
            throw new InvalidOperationException("Modelo, face ou identificador de textura inválido.");

        if (!IsColor(settings.Specular) || !IsColor(settings.Emissive))
            throw new InvalidOperationException("Cor especular ou emissiva inválida.");

        if (!InRange(settings.Opacity, 0, 1) || !InRange(settings.Roughness, 0, 1) ||
            !InRange(settings.Metalness, 0, 1) || !InRange(settings.Shininess, 0, 200) ||
            !InRange(settings.EmissiveIntensity, 0, 5) ||
            !InRange(settings.RepeatU, 0.1, 10) || !InRange(settings.RepeatV, 0.1, 10) ||
            !InRange(settings.OffsetU, -1, 1) || !InRange(settings.OffsetV, -1, 1) ||
            !InRange(settings.TextureRotation, -180, 180))
            throw new InvalidOperationException("As propriedades de material ou mapeamento estão fora dos limites.");

        var normalized = settings with
        {
            Specular = settings.Specular.ToLowerInvariant(),
            Emissive = settings.Emissive.ToLowerInvariant()
        };
        return normalized == Defaults ? null : normalized;
    }

    private static bool InRange(double value, double min, double max) =>
        double.IsFinite(value) && value >= min && value <= max;

    private static bool IsColor(string? value) =>
        value is not null && Regex.IsMatch(value, "\\A#[0-9a-fA-F]{6}\\z", RegexOptions.CultureInvariant);
}
