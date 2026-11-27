using System.Text.Json;
using System.Text.RegularExpressions;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class ParticleSettings
{
    private sealed record Effect(Dictionary<string, JsonElement> Defaults, Dictionary<string, JsonElement> Fields);
    private sealed record CatalogData(int MaxEffects, int MaxPerEffect, int MaxTotal,
        Dictionary<string, JsonElement> Common, Dictionary<string, Effect> Effects);

    private static readonly CatalogData Catalog = LoadCatalog();
    public static RoomParticlesDto Default { get; } = new(0, JsonSerializer.SerializeToElement(new { }));

    private static CatalogData LoadCatalog()
    {
        using var stream = typeof(ParticleSettings).Assembly.GetManifestResourceStream("ParticleCatalog.json")
            ?? throw new InvalidOperationException("Catálogo de partículas indisponível.");
        return JsonSerializer.Deserialize<CatalogData>(stream, new JsonSerializerOptions(JsonSerializerDefaults.Web))
            ?? throw new InvalidOperationException("Catálogo de partículas inválido.");
    }

    public static RoomParticlesDto FromStorage(string? json)
    {
        if (json is null) return Default;
        var state = JsonSerializer.Deserialize<RoomParticlesDto>(json);
        if (state is null || state.Revision < 0 || state.Effects.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("O estado de partículas persistido é inválido.");
        var effects = Default.Effects;
        foreach (var item in state.Effects.EnumerateObject())
            effects = Apply(effects, new ParticleCommandDto("add", item.Name, item.Value));
        return state with { Effects = effects };
    }

    public static JsonElement Apply(JsonElement current, ParticleCommandDto command)
    {
        if (command is null || !Guid.TryParseExact(command.Id, "D", out var id) || command.Id != id.ToString())
            throw new InvalidOperationException("Identificador de efeito inválido.");
        var effects = current.EnumerateObject().ToDictionary(item => item.Name, item => item.Value);
        var exists = effects.TryGetValue(command.Id, out var previous);
        if (command.Operation is "remove" or "reset")
        {
            if (command.Patch is not null)
                throw new InvalidOperationException("Esse comando não recebe parâmetros.");
            if (command.Operation == "remove") effects.Remove(command.Id);
            else if (exists) effects[command.Id] = Defaults(previous.GetProperty("type").GetString()!);
            else throw new InvalidOperationException("O efeito não existe mais.");
        }
        else if (command.Operation is "add" or "patch")
        {
            if (command.Operation == "patch" && !exists)
                throw new InvalidOperationException("O efeito não existe mais.");
            var candidate = Patch(command.Operation == "patch" ? previous : null, command.Patch);
            if (command.Operation == "add" && exists) return current;
            effects[command.Id] = candidate;
        }
        else throw new InvalidOperationException("Comando de partículas inválido.");

        if (effects.Count > Catalog.MaxEffects)
            throw new InvalidOperationException($"Limite de {Catalog.MaxEffects} efeitos por sala.");
        if (effects.Values.Sum(effect => effect.GetProperty("count").GetInt32()) > Catalog.MaxTotal)
            throw new InvalidOperationException($"Orçamento de {Catalog.MaxTotal} partículas por sala.");
        return JsonSerializer.SerializeToElement(effects);
    }

    private static JsonElement Defaults(string type)
    {
        var effect = Catalog.Effects[type];
        var values = new Dictionary<string, JsonElement> { ["type"] = JsonSerializer.SerializeToElement(type) };
        foreach (var (key, rule) in Catalog.Common.Concat(effect.Fields))
            values.Add(key, rule.ValueKind == JsonValueKind.Array ? rule[0] : rule);
        foreach (var (key, value) in effect.Defaults) values[key] = value;
        return JsonSerializer.SerializeToElement(values);
    }

    private static JsonElement Patch(JsonElement? previous, JsonElement? patch)
    {
        if (patch is null || patch.Value.ValueKind != JsonValueKind.Object)
            throw new InvalidOperationException("A alteração do efeito deve ser um objeto.");
        var priorType = previous?.GetProperty("type").GetString();
        var type = patch.Value.TryGetProperty("type", out var typeValue)
            ? typeValue.ValueKind == JsonValueKind.String ? typeValue.GetString() : null
            : priorType;
        if (type is null || !Catalog.Effects.TryGetValue(type, out var effect))
            throw new InvalidOperationException("Tipo de efeito inválido.");
        var next = Defaults(type).EnumerateObject().ToDictionary(item => item.Name, item => item.Value);
        if (previous is { } prior)
        {
            foreach (var item in prior.EnumerateObject())
                if (type == priorType || Catalog.Common.ContainsKey(item.Name)) next[item.Name] = item.Value;
        }
        var seen = new HashSet<string>(StringComparer.Ordinal);
        foreach (var item in patch.Value.EnumerateObject())
        {
            var key = item.Name;
            if (!seen.Add(key)) throw new InvalidOperationException("Parâmetro de partículas repetido.");
            if (key == "type") continue;
            if (!Catalog.Common.TryGetValue(key, out var rule) && !effect.Fields.TryGetValue(key, out rule))
                throw new InvalidOperationException("Parâmetro incompatível com o efeito.");
            next[key] = Validate(key, item.Value, rule);
        }
        return JsonSerializer.SerializeToElement(next);
    }

    private static JsonElement Validate(string key, JsonElement value, JsonElement rule)
    {
        if (rule.ValueKind == JsonValueKind.Array && value.ValueKind == JsonValueKind.Number &&
            value.TryGetDouble(out var number) && double.IsFinite(number) &&
            number >= rule[1].GetDouble() && number <= rule[2].GetDouble())
        {
            if (key == "count" && number > Catalog.MaxPerEffect)
                throw new InvalidOperationException($"Limite de {Catalog.MaxPerEffect} partículas por efeito.");
            if (key is not ("count" or "seed" or "arms")) return JsonSerializer.SerializeToElement(number);
            if (number == Math.Truncate(number)) return JsonSerializer.SerializeToElement((int)number);
        }
        if (rule.ValueKind is JsonValueKind.True or JsonValueKind.False &&
            value.ValueKind is JsonValueKind.True or JsonValueKind.False)
            return value;
        if (rule.ValueKind == JsonValueKind.String && value.ValueKind == JsonValueKind.String)
        {
            var color = value.GetString()!;
            if (color.Length == 7 && Regex.IsMatch(color, "\\A#[0-9a-fA-F]{6}\\z", RegexOptions.CultureInvariant))
                return JsonSerializer.SerializeToElement(color.ToLowerInvariant());
        }
        throw new InvalidOperationException($"Valor inválido para {key}.");
    }
}
