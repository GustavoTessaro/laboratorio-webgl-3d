using System.Text.Json;
using System.Text.RegularExpressions;
using Laboratorio.Collaboration.Contracts;

namespace Laboratorio.Collaboration.Services;

internal static class ShaderSettings
{
    private static readonly JsonElement Catalog = Load();

    private static JsonElement Load()
    {
        using var stream = typeof(ShaderSettings).Assembly.GetManifestResourceStream("ShaderCatalog.json")!;
        using var document = JsonDocument.Parse(stream);
        return document.RootElement.Clone();
    }

    public static ShaderDescriptorDto? Normalize(ShaderDescriptorDto? input)
    {
        if (input is null) return null;
        if (input.Id is null || !Catalog.TryGetProperty(input.Id, out var preset))
            throw new InvalidOperationException("Identificador de shader inválido.");
        var fields = preset.GetProperty("fields");
        var normalized = new ShaderParameterValues();
        if (input.Parameters is not null)
        {
            foreach (var (key, value) in input.Parameters)
            {
                if (!fields.TryGetProperty(key, out var rule))
                    throw new InvalidOperationException("Parâmetro incompatível com este shader.");
                if (rule.ValueKind == JsonValueKind.Array)
                {
                    if (value.ValueKind != JsonValueKind.Number || !value.TryGetDouble(out var number) ||
                        !double.IsFinite(number) || number < rule[1].GetDouble() || number > rule[2].GetDouble())
                        throw new InvalidOperationException("Parâmetro do shader fora dos limites.");
                    if (number != rule[0].GetDouble()) normalized[key] = JsonSerializer.SerializeToElement(number);
                }
                else
                {
                    var color = value.ValueKind == JsonValueKind.String ? value.GetString() : null;
                    if (color is null || !Regex.IsMatch(color, "\\A#[0-9a-fA-F]{6}\\z"))
                        throw new InvalidOperationException("Use uma cor hexadecimal com seis dígitos.");
                    color = color.ToLowerInvariant();
                    if (color != rule.GetString()) normalized[key] = JsonSerializer.SerializeToElement(color);
                }
            }
        }
        return new ShaderDescriptorDto(input.Id, normalized.Count == 0 ? null : normalized);
    }

    public static double Displacement(MaterialSettingsDto? material)
    {
        if (material is not { Kind: "shader", Shader.Id: "wave" }) return 0;
        return material.Shader.Parameters?.TryGetValue("amplitude", out var amplitude) == true
            ? amplitude.GetDouble()
            : Catalog.GetProperty("wave").GetProperty("fields").GetProperty("amplitude")[0].GetDouble();
    }
}
