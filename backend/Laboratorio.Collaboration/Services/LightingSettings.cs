using System.Text.Json;
using System.Text.RegularExpressions;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class LightingSettings
{
    private static readonly Dictionary<string, Dictionary<string, JsonElement>> Catalog = LoadCatalog();
    public static RoomLightingDto Default { get; } = new(0, JsonSerializer.SerializeToElement(
        Catalog.ToDictionary(group => group.Key, group => group.Value.ToDictionary(
            field => field.Key, field => field.Value.ValueKind == JsonValueKind.Array ? field.Value[0] : field.Value))));

    private static Dictionary<string, Dictionary<string, JsonElement>> LoadCatalog()
    {
        using var stream = typeof(LightingSettings).Assembly.GetManifestResourceStream("LightingCatalog.json")
            ?? throw new InvalidOperationException("Catálogo de iluminação indisponível.");
        return JsonSerializer.Deserialize<Dictionary<string, Dictionary<string, JsonElement>>>(stream)
            ?? throw new InvalidOperationException("Catálogo de iluminação inválido.");
    }

    public static RoomLightingDto FromStorage(string? json)
    {
        if (json is null) return Default;
        var state = JsonSerializer.Deserialize<RoomLightingDto>(json);
        if (state is null || state.Revision < 0 || state.Settings.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("A iluminação persistida é inválida.");
        var settings = Default.Settings;
        foreach (var group in state.Settings.EnumerateObject())
            settings = Apply(settings, group.Name, group.Value);
        return state with { Settings = settings };
    }

    public static JsonElement Apply(JsonElement current, string? group, JsonElement? patch)
    {
        if (group is null && patch is null) return Default.Settings;
        if (group is null || !Catalog.TryGetValue(group, out var rules))
            throw new InvalidOperationException("Grupo de iluminação inválido.");

        var groups = current.EnumerateObject().ToDictionary(item => item.Name, item => item.Value);
        if (patch is null)
        {
            groups[group] = Default.Settings.GetProperty(group);
            return JsonSerializer.SerializeToElement(groups);
        }
        if (patch.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("A alteração de iluminação deve ser um objeto.");

        var values = groups[group].EnumerateObject().ToDictionary(item => item.Name, item => item.Value);
        var updated = new HashSet<string>(StringComparer.Ordinal);
        foreach (var (key, value) in patch.Value.EnumerateObject().Select(item => (item.Name, item.Value)))
        {
            if (!updated.Add(key) || !rules.TryGetValue(key, out var rule))
                throw new InvalidOperationException("Propriedade de iluminação inválida ou repetida.");
            values[key] = Validate(key, value, rule);
        }
        if (group is "directional" or "spot")
        {
            var x = values["x"].GetDouble() - values["targetX"].GetDouble();
            var y = values["y"].GetDouble() - values["targetY"].GetDouble();
            var z = values["z"].GetDouble() - values["targetZ"].GetDouble();
            if (x * x + y * y + z * z < 0.0001)
                throw new InvalidOperationException("A posição da luz e o alvo precisam ser distintos.");
        }
        if (group == "hemisphere")
        {
            var x = values["x"].GetDouble();
            var y = values["y"].GetDouble();
            var z = values["z"].GetDouble();
            if (x * x + y * y + z * z < 0.0001)
                throw new InvalidOperationException("A luz hemisférica precisa de um eixo diferente de zero.");
        }
        groups[group] = JsonSerializer.SerializeToElement(values);
        return JsonSerializer.SerializeToElement(groups);
    }

    private static JsonElement Validate(string key, JsonElement value, JsonElement rule)
    {
        if (rule.ValueKind == JsonValueKind.Array && value.ValueKind == JsonValueKind.Number &&
            value.TryGetDouble(out var number) && double.IsFinite(number) &&
            number >= rule[1].GetDouble() && number <= rule[2].GetDouble() &&
            (key != "distance" || number == 0 || number >= 0.5))
            return JsonSerializer.SerializeToElement(number);
        if (rule.ValueKind is JsonValueKind.True or JsonValueKind.False &&
            value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return value;
        if (rule.ValueKind == JsonValueKind.String && value.ValueKind == JsonValueKind.String)
        {
            var text = value.GetString()!;
            if (key == "shadowQuality" ? text is "low" or "medium" or "high" :
                text.Length == 7 && Regex.IsMatch(text, "\\A#[0-9a-fA-F]{6}\\z", RegexOptions.CultureInvariant))
                return JsonSerializer.SerializeToElement(text.ToLowerInvariant());
        }
        throw new InvalidOperationException($"Valor inválido para {key}.");
    }
}
