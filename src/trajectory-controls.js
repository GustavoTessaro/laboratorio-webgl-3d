import { bindLocalInput } from './edit-gestures.js';
import { DEFAULT_TRAJECTORY, MAX_CONTROL_POINTS, TRAJECTORY_TYPES } from './graphics/trajectory-settings.js';

export function bindTrajectoryControls(root, scene, signal) {
  const document = root.ownerDocument;
  const fields = root.querySelector('[data-trajectory-fields]');
  const status = root.querySelector('[data-trajectory-status]');
  const form = document.createElement('fieldset');
  const entries = [];
  const gestures = [];
  const points = [];
  let entity;
  let locked;
  let editing;

  function report(message) { status.textContent = message; }
  function settings() { return entity?.trajectory ?? DEFAULT_TRAJECTORY; }

  function edit(change, preview = false, target = entity) {
    if (!target || locked) return;
    try {
      scene.setTrajectory(target, { ...settings(), ...change }, preview);
      report('');
    } catch (error) {
      scene.cancelTrajectoryPreview(target);
      report(error.message);
    }
    if (!preview) sync(entity, locked);
  }

  function field(parent, label, options) {
    const row = document.createElement('label');
    row.className = 'geometry-field';
    row.append(label);
    const input = document.createElement(options.values ? 'select' : 'input');
    input.className = options.checkbox ? '' : 'geometry-select';
    if (options.values) {
      for (const [value, name] of Object.entries(options.values)) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = name;
        input.append(option);
      }
    } else if (options.checkbox) {
      input.type = 'checkbox';
    } else {
      input.type = 'number';
      [input.min, input.max, input.step] = options.range;
    }
    row.append(input);
    parent.append(row);
    return { row, input };
  }

  function numberGesture(input, change) {
    gestures.push(bindLocalInput(input, {
      signal,
      getEntity: () => entity,
      preview(value, target) {
        editing = input;
        if (value !== '') edit(change(Number(value)), true, target);
        else scene.cancelTrajectoryPreview(target);
      },
      restore(target, willCommit) {
        editing = null;
        scene.cancelTrajectoryPreview(target);
        if (!willCommit) sync(entity, locked);
      },
      commit(value, target) {
        if (value === '') sync(entity, locked);
        else edit(change(Number(value)), false, target);
      },
    }));
  }

  function addField(key, label, options, types) {
    const { row, input } = field(form, label, options);
    entries.push({ key, row, input, types });
    if (options.range) numberGesture(input, (value) => ({ [key]: value }));
    else input.addEventListener('change', () => {
      const value = options.checkbox ? input.checked : input.value;
      edit(key === 'type' ? { type: value, points: null } : { [key]: value });
    }, { signal });
  }

  const analytical = ['circle', 'ellipse', 'helix'];
  addField('enabled', 'Ativar trajetória', { checkbox: true });
  addField('type', 'Tipo de percurso', { values: TRAJECTORY_TYPES });
  addField('duration', 'Duração (segundos)', { range: [0.5, 120, 0.1] });
  addField('reverse', 'Inverter sentido', { checkbox: true });
  addField('mode', 'Repetição', { values: { once: 'Uma vez', loop: 'Contínua', pingpong: 'Ida e volta' } });
  addField('orient', 'Orientar pela tangente', { checkbox: true });
  addField('plane', 'Plano', { values: { xy: 'XY', xz: 'XZ', yz: 'YZ' } }, analytical);
  addField('radius', 'Raio no primeiro eixo', { range: [0.05, 8, 0.05] }, analytical);
  addField('radiusB', 'Raio no segundo eixo', { range: [0.05, 8, 0.05] }, ['ellipse']);
  addField('height', 'Altura da hélice', { range: [-8, 8, 0.1] }, ['helix']);
  addField('turns', 'Voltas da hélice', { range: [1, 8, 1] }, ['helix']);

  function button(parent, text, action) {
    const control = document.createElement('button');
    control.type = 'button';
    control.className = 'axis-option';
    control.textContent = text;
    control.addEventListener('click', action, { signal });
    parent.append(control);
    return control;
  }

  for (let index = 0; index < MAX_CONTROL_POINTS; index += 1) {
    const row = document.createElement('fieldset');
    const legend = document.createElement('legend');
    legend.textContent = `Ponto ${index + 1}`;
    row.append(legend);
    const inputs = ['x', 'y', 'z'].map((axis) => {
      const { input } = field(row, axis.toUpperCase(), { range: [-8, 8, 0.1] });
      numberGesture(input, (value) => ({
        points: settings().points.map((point, i) => i === index ? { ...point, [axis]: value } : point),
      }));
      return input;
    });
    const remove = button(row, 'Remover ponto', () =>
      edit({ points: settings().points.filter((_, i) => i !== index) }));
    points.push({ row, inputs, remove });
    form.append(row);
  }
  const add = button(form, 'Adicionar ponto', () => {
    const points = settings().points;
    const last = points.at(-1);
    const index = points.length - 1;
    const previous = points[index - 1];
    const midpoint = Object.fromEntries(['x', 'y', 'z'].map((axis) => [axis, (last[axis] + previous[axis]) / 2]));
    edit({ points: [...points.slice(0, -1), midpoint, last] });
  });
  button(form, 'Restaurar trajetória padrão', () => {
    try {
      scene.setTrajectory(entity, null);
      report('');
    } catch (error) { report(error.message); }
    sync(entity, locked);
  });
  fields.append(form);

  const local = document.createElement('fieldset');
  const legend = document.createElement('legend');
  legend.textContent = 'Reprodução nesta sessão';
  local.append(legend);
  for (const [action, label] of Object.entries({ play: 'Reproduzir', pause: 'Pausar', restart: 'Reiniciar' })) {
    button(local, label, () => scene.changeTrajectoryPlayback(action));
  }
  const { input: helper } = field(local, 'Exibir percurso e pontos (verde: início, vermelho: fim)', { checkbox: true });
  helper.addEventListener('change', () => scene.setTrajectoryHelper(helper.checked), { signal });
  const legendText = document.createElement('p');
  legendText.className = 'geometry-description';
  legendText.textContent = 'A seta indica o sentido inicial. Em percursos fechados, início e fim coincidem.';
  local.append(legendText);
  fields.append(local);

  function cancel(id) {
    for (const gesture of gestures) {
      if (id === undefined || gesture.entity?.id === id) gesture.cancel();
    }
  }

  function sync(next, nextLocked) {
    if (entity !== next || (!locked && nextLocked)) {
      const old = entity;
      entity = next;
      locked = nextLocked;
      if (old) cancel(old.id);
      report(next ? '' : 'Selecione um objeto para configurar o percurso.');
    }
    entity = next;
    locked = nextLocked;
    form.disabled = !entity || locked;
    local.disabled = !entity?.trajectory?.enabled;
    const config = settings();
    for (const { key, row, input, types } of entries) {
      row.hidden = Boolean(types && !types.includes(config.type));
      if (input === editing) continue;
      if (input.type === 'checkbox') input.checked = config[key];
      else input.value = config[key];
    }
    for (const [index, { row, inputs, remove }] of points.entries()) {
      const point = config.points?.[index];
      row.hidden = !point;
      remove.hidden = config.type !== 'catmull';
      remove.disabled = (config.points?.length ?? 0) <= 2;
      if (point) inputs.forEach((input, i) => { if (input !== editing) input.value = point[['x', 'y', 'z'][i]]; });
    }
    add.hidden = config.type !== 'catmull';
    add.disabled = (config.points?.length ?? 0) >= MAX_CONTROL_POINTS;
  }

  return { sync, cancel, report };
}
