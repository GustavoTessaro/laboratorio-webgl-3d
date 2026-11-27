import { bindLocalInput } from './edit-gestures.js';
import { PARTICLE_BUDGET, PARTICLE_TYPES, particleRules } from './graphics/particle-settings.js';

const descriptions = {
  fountain: ['Fonte', 'A velocidade lança os pontos para cima, a gravidade os traz de volta e o tempo de vida define a reciclagem.'],
  rain: ['Chuva', 'Os pontos caem desde a altura do emissor. O vento desloca a chuva no eixo X.'],
  snow: ['Neve', 'Os pontos caem lentamente e oscilam para os lados. A dispersão aumenta a oscilação.'],
  galaxy: ['Galáxia', 'Os pontos giram em braços espirais. A dispersão aumenta a espessura do disco.'],
};
const labels = {
  enabled: 'Ativar efeito', count: 'Quantidade', color: 'Cor', size: 'Tamanho dos pontos (px)',
  opacity: 'Opacidade', speed: 'Velocidade', x: 'Emissor X', y: 'Emissor Y', z: 'Emissor Z',
  seed: 'Semente pseudoaleatória', area: 'Largura da área', dispersion: 'Dispersão',
  gravity: 'Gravidade', life: 'Tempo de vida (s)', wind: 'Vento no eixo X',
  radius: 'Raio do disco', arms: 'Braços espirais',
};
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function bindParticleControls(root, session, system, signal) {
  const document = root.ownerDocument;
  const addType = root.querySelector('[data-particle-add-type]');
  const add = root.querySelector('[data-particle-add]');
  const selection = root.querySelector('[data-particle-selection]');
  const type = root.querySelector('[data-particle-type]');
  const editor = root.querySelector('[data-particle-editor]');
  const fields = root.querySelector('[data-particle-fields]');
  const hint = root.querySelector('[data-particle-hint]');
  const count = root.querySelector('[data-particle-count]');
  const message = root.querySelector('[data-particle-message]');
  const play = root.querySelector('[data-particle-play]');
  let current = {};
  let selectedId = null;
  let renderedId = null;
  let renderedType = null;
  let fieldsLifetime = new AbortController();
  let controls = [];

  function option(value, name) {
    const element = document.createElement('option');
    element.value = value;
    element.textContent = name;
    return element;
  }
  for (const select of [addType, type]) {
    select.replaceChildren(...PARTICLE_TYPES.map((kind) => option(kind, descriptions[kind][0])));
  }

  function report(text = '') {
    message.hidden = !text;
    message.textContent = text;
  }
  function attempt(action) {
    try { action(); report(); } catch (error) { report(error.message); }
  }
  function cancel() {
    for (const { gesture } of controls) gesture?.cancel();
  }
  signal.addEventListener('abort', () => fieldsLifetime.abort(), { once: true });

  function renderFields(id, effectType) {
    fields.replaceChildren();
    if (!effectType) return;
    for (const [key, rule] of Object.entries(particleRules(effectType))) {
      const label = document.createElement('label');
      const title = document.createElement('span');
      title.textContent = labels[key];
      const input = document.createElement('input');
      input.dataset.particleField = key;
      const output = document.createElement('output');
      const toggle = typeof rule === 'boolean';
      const slider = Array.isArray(rule) && key !== 'seed';
      let gesture;
      if (slider || key === 'color') {
        label.className = slider ? 'range-control' : 'custom-color-control';
        input.type = slider ? 'range' : 'color';
        if (slider) {
          [input.min, input.max, input.step] = rule.slice(1).map(String);
          const line = document.createElement('span');
          line.className = 'range-label';
          line.append(title, output);
          label.append(line, input);
        } else label.append(title, input);
        const command = (value) => ({ operation: 'patch', id, patch: { [key]: slider ? Number(value) : value } });
        gesture = bindLocalInput(input, {
          getEntity: () => selectedId,
          signal: fieldsLifetime.signal,
          preview(value) {
            if (slider) output.value = format.format(Number(value));
            attempt(() => session.preview(command(value)));
          },
          restore(_, willCommit) { if (!willCommit) session.cancel(); },
          commit(value) { attempt(() => session.commit(command(value))); },
        });
      } else {
        label.className = toggle ? 'custom-color-control' : 'particle-seed';
        input.type = toggle ? 'checkbox' : 'number';
        if (!toggle) [input.min, input.max, input.step] = rule.slice(1).map(String);
        label.append(title, input);
        input.addEventListener('change', () => {
          attempt(() => session.commit({
            operation: 'patch', id, patch: { [key]: toggle ? input.checked : input.valueAsNumber },
          }));
          sync(current);
        }, { signal: fieldsLifetime.signal });
      }
      fields.append(label);
      controls.push({ key, input, output, toggle, slider, gesture });
    }
  }

  let selectionKey;
  function sync(effects) {
    current = effects;
    const ids = Object.keys(effects);
    if (!Object.hasOwn(effects, selectedId)) selectedId = ids[0] ?? null;
    const effect = effects[selectedId];
    const key = ids.map((id) => `${id}:${effects[id].type}`).join('|');
    if (selectionKey !== key) {
      selectionKey = key;
      selection.replaceChildren(...(ids.length
        ? ids.map((id, index) => option(id, `${index + 1} · ${descriptions[effects[id].type][0]}`))
        : [option('', 'Nenhum efeito')]));
    }
    selection.value = selectedId ?? '';
    selection.disabled = !effect;
    editor.hidden = !effect;
    add.disabled = ids.length >= PARTICLE_BUDGET.effects;
    const active = Object.values(effects).reduce((total, config) => total + (config.enabled ? config.count : 0), 0);
    count.value = `${format.format(active)} de ${format.format(PARTICLE_BUDGET.total)} partículas visíveis · ${ids.length}/${PARTICLE_BUDGET.effects} efeitos`;
    if (renderedId !== selectedId || renderedType !== effect?.type) {
      const previous = controls;
      controls = [];
      renderedId = selectedId;
      renderedType = effect?.type;
      fieldsLifetime.abort();
      fieldsLifetime = new AbortController();
      for (const { gesture } of previous) gesture?.cancel();
      renderFields(selectedId, effect?.type);
    }
    if (!effect) return;
    type.value = effect.type;
    hint.textContent = descriptions[effect.type][1];
    play.textContent = system.isPlaying(selectedId) ? 'Pausar neste navegador' : 'Reproduzir neste navegador';
    for (const { key, input, output, toggle, slider, gesture } of controls) {
      if (gesture?.entity) continue;
      if (toggle) input.checked = effect[key];
      else input.value = String(effect[key]);
      if (slider) output.value = format.format(effect[key]);
    }
  }

  function commit(operation, patch = null) {
    if (selectedId) attempt(() => session.commit({ operation, id: selectedId, patch }));
  }
  add.addEventListener('click', () => {
    cancel();
    const id = crypto.randomUUID();
    selectedId = id;
    attempt(() => session.commit({ operation: 'add', id, patch: { type: addType.value } }));
  }, { signal });
  selection.addEventListener('change', () => {
    const id = selection.value;
    cancel();
    selectedId = id;
    sync(current);
  }, { signal });
  type.addEventListener('change', () => {
    const kind = type.value;
    cancel();
    commit('patch', { type: kind });
  }, { signal });
  root.querySelector('[data-particle-reset]').addEventListener('click', () => { cancel(); commit('reset'); }, { signal });
  root.querySelector('[data-particle-remove]').addEventListener('click', () => { cancel(); commit('remove'); }, { signal });
  play.addEventListener('click', () => {
    system.setPlaying(selectedId, !system.isPlaying(selectedId));
    sync(current);
  }, { signal });
  root.querySelector('[data-particle-restart]').addEventListener('click', () => system.restart(selectedId), { signal });
  sync(current);
  return { sync, report, cancel };
}
