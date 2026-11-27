import { bindLocalInput } from './edit-gestures.js';
import { DEFAULT_LIGHTING, lightingCatalog } from './graphics/lighting-settings.js';

const descriptions = {
  ambient: ['Ambiente', 'Ilumina todas as direções com a mesma cor e suaviza o contraste.'],
  hemisphere: ['Hemisférica', 'Mistura as cores do céu e do chão. O vetor de posição define o eixo entre elas.'],
  directional: ['Direcional', 'Emite raios paralelos. A posição e o alvo definem a direção da luz.'],
  point: ['Pontual', 'Emite em todas as direções. Alcance zero é ilimitado. A sombra cobre seis direções e custa mais.'],
  spot: ['Focal', 'Ilumina um cone voltado ao alvo. A penumbra suaviza a borda e alcance zero é ilimitado.'],
  environment: ['Chão e sombras', 'O chão recebe sombras. A grade marca o plano de referência. Resoluções maiores usam mais GPU.'],
};
const labels = {
  enabled: 'Ativar luz', color: 'Cor', intensity: 'Intensidade', groundColor: 'Cor do chão refletido',
  x: 'Posição X', y: 'Posição Y', z: 'Posição Z', targetX: 'Alvo X', targetY: 'Alvo Y', targetZ: 'Alvo Z',
  distance: 'Alcance', decay: 'Decaimento', angle: 'Semiângulo de abertura (°)', penumbra: 'Penumbra',
  castShadow: 'Projetar sombras', floorVisible: 'Mostrar chão receptor', gridVisible: 'Mostrar grade',
  floorColor: 'Cor do chão', shadowQuality: 'Resolução das sombras',
};
const qualityLabels = { low: 'Baixa', medium: 'Média', high: 'Alta' };
const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function bindLightingControls(root, session, setHelper, signal) {
  const document = root.ownerDocument;
  const container = root.querySelector('[data-lighting-groups]');
  const message = root.querySelector('[data-lighting-message]');
  const controls = [];
  const editingRoom = {};

  function report(text = '') {
    message.textContent = text;
    message.hidden = !text;
  }

  function attempt(action) {
    try { action(); report(); } catch (error) { report(error.message); }
  }

  function addField(parent, group, key, rule) {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = group === 'hemisphere' && key === 'color' ? 'Cor do céu' : labels[key];
    const quality = key === 'shadowQuality';
    const input = document.createElement(quality ? 'select' : 'input');
    input.dataset.lightProperty = key;
    const slider = Array.isArray(rule);
    const toggle = typeof rule === 'boolean';
    const output = document.createElement('output');
    let gesture;
    if (quality) {
      label.className = 'geometry-field material-field';
      input.className = 'geometry-select';
      for (const [name, description] of Object.entries(qualityLabels)) {
        const option = document.createElement('option');
        option.value = name;
        option.textContent = description;
        input.append(option);
      }
      label.append(title, input);
    } else if (slider) {
      label.className = 'range-control';
      input.type = 'range';
      [input.min, input.max, input.step] = rule.slice(1).map(String);
      const line = document.createElement('span');
      line.className = 'range-label';
      line.append(title, output);
      label.append(line, input);
    } else {
      label.className = 'custom-color-control';
      input.type = toggle ? 'checkbox' : 'color';
      label.append(title, input);
    }
    if (slider || input.type === 'color') {
      const parse = slider ? Number : (value) => value;
      gesture = bindLocalInput(input, {
        signal,
        getEntity: () => editingRoom,
        preview(value) {
          if (slider) output.value = format.format(Number(value));
          attempt(() => session.preview(group, { [key]: parse(value) }));
        },
        restore(_, willCommit) { if (!willCommit) session.cancel(); },
        commit(value) { attempt(() => session.commit(group, { [key]: parse(value) })); },
      });
    } else {
      input.addEventListener('change', () => {
        attempt(() => session.commit(group, { [key]: toggle ? input.checked : input.value }));
      }, { signal });
    }
    controls.push({ group, key, input, output, slider, toggle, gesture });
    parent.append(label);
  }

  function helperOption(parent, group, type, text) {
    const label = document.createElement('label');
    label.className = 'custom-color-control';
    const title = document.createElement('span');
    title.textContent = text;
    const input = document.createElement('input');
    input.type = 'checkbox';
    input.dataset.lightHelper = type;
    input.addEventListener('change', () => setHelper(group, type, input.checked), { signal });
    label.append(title, input);
    parent.append(label);
  }

  for (const [group, fields] of Object.entries(lightingCatalog)) {
    const section = document.createElement('details');
    section.className = 'lighting-group';
    section.dataset.lightGroup = group;
    section.open = group === 'directional';
    const summary = document.createElement('summary');
    summary.textContent = descriptions[group][0];
    const hint = document.createElement('p');
    hint.className = 'geometry-description';
    hint.textContent = descriptions[group][1];
    section.append(summary, hint);
    for (const [key, rule] of Object.entries(fields)) addField(section, group, key, rule);
    if (['hemisphere', 'directional', 'point', 'spot'].includes(group)) {
      helperOption(section, group, 'light', 'Mostrar auxiliar neste navegador');
    }
    if (['directional', 'spot'].includes(group)) {
      helperOption(section, group, 'shadow', 'Mostrar câmera de sombra neste navegador');
    }
    const reset = document.createElement('button');
    reset.className = 'reset-appearance reset-lighting';
    reset.type = 'button';
    reset.textContent = 'Restaurar padrão';
    reset.addEventListener('click', () => attempt(() => session.commit(group, null)), { signal });
    section.append(reset);
    container.append(section);
  }

  root.querySelector('[data-reset-lighting]').addEventListener('click', () => {
    attempt(() => session.commit(null, null));
  }, { signal });

  function sync(state) {
    for (const { group, key, input, output, slider, toggle, gesture } of controls) {
      if (gesture?.entity) continue;
      const value = state[group][key];
      if (toggle) input.checked = value;
      else input.value = String(value);
      if (slider) output.value = format.format(value);
    }
  }
  sync(DEFAULT_LIGHTING);

  return {
    report,
    sync,
    cancel() { for (const { gesture } of controls) gesture?.cancel(); },
  };
}
