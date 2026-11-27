import catalog from '../../backend/Laboratorio.Collaboration/Contracts/LightingCatalog.json' with { type: 'json' };

export const SHADOW_QUALITIES = ['low', 'medium', 'high'];
export { catalog as lightingCatalog };
export const DEFAULT_LIGHTING = Object.freeze(Object.fromEntries(Object.entries(catalog).map(([group, fields]) => [
  group, Object.freeze(Object.fromEntries(Object.entries(fields).map(([key, rule]) => [
    key, Array.isArray(rule) ? rule[0] : rule,
  ]))),
])));

export function changeLighting(settings, group, patch) {
  if (group === null && patch === null) return DEFAULT_LIGHTING;
  if (!Object.hasOwn(catalog, group)) throw new Error('Grupo de iluminação inválido.');
  if (patch === null) return { ...settings, [group]: DEFAULT_LIGHTING[group] };
  if (typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Configuração de iluminação inválida.');
  const next = { ...settings[group] };
  for (const [key, value] of Object.entries(patch)) {
    if (!Object.hasOwn(catalog[group], key)) throw new Error('Propriedade de iluminação inválida.');
    const rule = catalog[group][key];
    let valid;
    if (Array.isArray(rule)) valid = Number.isFinite(value) && value >= rule[1] && value <= rule[2];
    else if (typeof rule === 'boolean') valid = typeof value === 'boolean';
    else if (key === 'shadowQuality') valid = SHADOW_QUALITIES.includes(value);
    else valid = typeof value === 'string' && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);
    if (!valid) throw new Error(`Valor inválido para ${key}.`);
    if (key === 'distance' && value > 0 && value < 0.5) {
      throw new Error('Use alcance zero (ilimitado) ou pelo menos 0,5 unidade.');
    }
    next[key] = typeof value === 'string' ? value.toLowerCase() : value;
  }
  if ((group === 'spot' || group === 'directional') &&
      Math.hypot(next.x - next.targetX, next.y - next.targetY, next.z - next.targetZ) < 0.01) {
    throw new Error('A posição da luz e o alvo precisam ser distintos.');
  }
  if (group === 'hemisphere' && Math.hypot(next.x, next.y, next.z) < 0.01) {
    throw new Error('A luz hemisférica precisa de um eixo diferente de zero.');
  }
  return { ...settings, [group]: next };
}

export function sameLighting(first, second) {
  return Object.entries(DEFAULT_LIGHTING).every(([group, fields]) =>
    Object.keys(fields).every((key) => first[group][key] === second[group][key]));
}
