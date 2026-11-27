import catalog from '../../backend/Laboratorio.Collaboration/Contracts/ParticleCatalog.json' with { type: 'json' };

export const PARTICLE_BUDGET = Object.freeze({
  effects: catalog.maxEffects, perEffect: catalog.maxPerEffect, total: catalog.maxTotal,
});
export const PARTICLE_TYPES = Object.keys(catalog.effects);
export const EMPTY_PARTICLES = Object.freeze({});
const integral = new Set(['count', 'seed', 'arms']);

export function particleRules(type) {
  if (!Object.hasOwn(catalog.effects, type)) throw new Error('Tipo de efeito inválido.');
  return { ...catalog.common, ...catalog.effects[type].fields };
}

export function particleDefaults(type) {
  const values = Object.fromEntries(Object.entries(particleRules(type)).map(([key, rule]) => [
    key, Array.isArray(rule) ? rule[0] : rule,
  ]));
  return { type, ...values, ...catalog.effects[type].defaults };
}

function withPatch(previous, patch) {
  if (!patch || typeof patch !== 'object' || Array.isArray(patch)) throw new Error('Alteração de partículas inválida.');
  const type = Object.hasOwn(patch, 'type') ? patch.type : previous?.type;
  const rules = particleRules(type);
  const next = particleDefaults(type);
  if (previous?.type === type) Object.assign(next, previous);
  else if (previous) for (const key of Object.keys(catalog.common)) next[key] = previous[key];
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'type') continue;
    if (!Object.hasOwn(rules, key)) throw new Error('Parâmetro incompatível com o efeito.');
    const rule = rules[key];
    const valid = Array.isArray(rule) ? Number.isFinite(value) && value >= rule[1] && value <= rule[2] &&
      (!integral.has(key) || Number.isInteger(value))
      : typeof rule === 'boolean' ? typeof value === 'boolean'
        : typeof value === 'string' && value.length === 7 && /^#[0-9a-f]{6}$/i.test(value);
    if (!valid) throw new Error(`Valor inválido para ${key}.`);
    next[key] = typeof value === 'string' ? value.toLowerCase() : value;
  }
  return next;
}

export function sameParticleSettings(first, second) {
  return Object.keys(first).length === Object.keys(second).length && Object.entries(first).every(([id, effect]) =>
    second[id] && Object.keys(effect).length === Object.keys(second[id]).length &&
    Object.entries(effect).every(([key, value]) => second[id][key] === value));
}

export function changeParticles(effects, { operation, id, patch = null }) {
  if (typeof id !== 'string' || !/^[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}$/.test(id)) {
    throw new Error('Identificador de efeito inválido.');
  }
  const previous = effects[id];
  const next = { ...effects };
  if (operation === 'remove' || operation === 'reset') {
    if (patch !== null) throw new Error('Esse comando não recebe parâmetros.');
    if (operation === 'remove') delete next[id];
    else {
      if (!previous) throw new Error('O efeito não existe mais.');
      next[id] = particleDefaults(previous.type);
    }
  } else if (operation === 'add' || operation === 'patch') {
    if (operation === 'patch' && !previous) throw new Error('O efeito não existe mais.');
    const candidate = withPatch(operation === 'patch' ? previous : null, patch);
    if (operation === 'add' && previous) return effects;
    next[id] = candidate;
  } else throw new Error('Comando de partículas inválido.');

  const list = Object.values(next);
  if (list.length > PARTICLE_BUDGET.effects) {
    throw new Error(`Limite de ${PARTICLE_BUDGET.effects} efeitos por sala.`);
  }
  if (list.reduce((total, effect) => total + effect.count, 0) > PARTICLE_BUDGET.total) {
    throw new Error(`Orçamento de ${PARTICLE_BUDGET.total} partículas por sala.`);
  }
  return next;
}
