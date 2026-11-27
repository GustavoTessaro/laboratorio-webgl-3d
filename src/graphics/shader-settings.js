import catalog from '../../backend/Laboratorio.Collaboration/Contracts/ShaderCatalog.json' with { type: 'json' };

export const shaderCatalog = catalog;
export const shaderLabels = {
  colorB: 'Cor secundária', direction: 'Direção do gradiente (°)', amplitude: 'Amplitude',
  frequency: 'Frequência da ondulação', speed: 'Velocidade (rad/s)', scale: 'Escala do padrão',
  intensity: 'Intensidade', power: 'Expoente do Fresnel', scanFrequency: 'Frequência da varredura',
  noiseScale: 'Escala do ruído', noiseMix: 'Mistura das duas escalas',
};

export function shaderParameters({ id, parameters }) {
  return Object.fromEntries(Object.entries(shaderCatalog[id].fields).map(([key, rule]) =>
    [key, parameters?.[key] ?? (Array.isArray(rule) ? rule[0] : rule)]));
}

export function normalizeShader(input) {
  if (input == null) return null;
  if (typeof input !== 'object' || Array.isArray(input) || !Object.hasOwn(shaderCatalog, input.id) ||
      Object.keys(input).some((key) => key !== 'id' && key !== 'parameters')) {
    throw new Error('Identificador ou descritor de shader inválido.');
  }
  const { id, parameters } = input;
  const fields = shaderCatalog[id].fields;
  if (parameters != null && (typeof parameters !== 'object' || Array.isArray(parameters))) {
    throw new Error('Os parâmetros do shader devem ser um objeto.');
  }
  const overrides = {};
  for (const [key, value] of Object.entries(parameters ?? {})) {
    if (!Object.hasOwn(fields, key)) throw new Error('Parâmetro incompatível com este shader.');
    const rule = fields[key];
    if (Array.isArray(rule)) {
      if (!Number.isFinite(value) || value < rule[1] || value > rule[2]) {
        throw new Error('Parâmetro do shader fora dos limites.');
      }
      if (value !== rule[0]) overrides[key] = value;
    } else {
      if (typeof value !== 'string' || value.length !== 7 || !/^#[0-9a-f]{6}$/i.test(value)) {
        throw new Error('Use uma cor hexadecimal com seis dígitos.');
      }
      if (value.toLowerCase() !== rule) overrides[key] = value.toLowerCase();
    }
  }
  return { id, parameters: Object.keys(overrides).length ? overrides : null };
}

export function sameShader(a, b) {
  if (a === b) return true;
  if (!a || !b) return (a ?? null) === (b ?? null);
  const keys = Object.keys(a.parameters ?? {});
  return a.id === b.id && keys.length === Object.keys(b.parameters ?? {}).length &&
    keys.every((key) => a.parameters[key] === b.parameters?.[key]);
}

export function shaderDisplacement(settings) {
  return settings?.kind === 'shader' && settings.shader?.id === 'wave'
    ? settings.shader.parameters?.amplitude ?? shaderCatalog.wave.fields.amplitude[0] : 0;
}

export function materialHalfSize(halfSize, settings, target) {
  const displacement = shaderDisplacement(settings);
  if (!displacement) return halfSize;
  target.copy(halfSize);
  target.y += displacement;
  return target;
}
