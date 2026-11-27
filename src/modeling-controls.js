import { bindLocalInput } from './edit-gestures.js';
import { encodeModelingPoints } from './graphics/modeling-geometries.js';

const SVG_NS = 'http://www.w3.org/2000/svg';

export function createModelingControls(fields, entity, info, { edit, cancelPreview, getEntity, signal }) {
  const document = fields.ownerDocument;
  const type = entity.type;
  const lathe = type === 'lathe';
  const wrapper = document.createElement('div');
  wrapper.className = 'modeling-editor';
  const diagram = document.createElementNS(SVG_NS, 'svg');
  diagram.setAttribute('role', 'img');
  diagram.setAttribute('aria-label', lathe ? 'Perfil em raio e altura, com eixo Y' : 'Contorno no plano XY');
  const line = document.createElementNS(SVG_NS, 'path');
  const axis = document.createElementNS(SVG_NS, 'line');
  const markers = document.createElementNS(SVG_NS, 'path');
  diagram.append(axis, line, markers);
  const label = document.createElement('label');
  label.className = 'geometry-field';
  label.append(lathe ? 'Perfil predefinido' : 'Forma predefinida');
  const presets = document.createElement('select');
  presets.className = 'geometry-select';
  const options = { '': { name: 'Selecione um modelo' }, ...info.presets };
  for (const [id, { name }] of Object.entries(options)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = name;
    presets.append(option);
  }
  label.append(presets);

  const pointEditor = document.createElement('details');
  pointEditor.className = 'inspection-group';
  const pointTitle = document.createElement('summary');
  const pointsList = document.createElement('div');
  const add = document.createElement('button');
  add.type = 'button';
  add.className = 'object-action';
  add.textContent = 'Inserir ponto no maior intervalo';
  pointEditor.append(pointTitle, pointsList, add);
  wrapper.append(label, diagram, pointEditor);
  fields.append(wrapper);
  const rows = [];
  let disabled = false;
  let drawnModel;

  function sync() {
    if (entity.type !== type) return;
    const model = (entity.geometryPreview?.spec ?? entity.geometrySpec).model;
    pointTitle.textContent = `Editar pontos (${entity.geometrySpec.model.points.length}/${info.maxPoints})`;
    for (const [index, { row, inputs, remove, gestures }] of rows.entries()) {
      const point = entity.geometrySpec.model.points[index];
      row.hidden = !point;
      if (!point) continue;
      inputs.forEach((input, axisIndex) => {
        input.disabled = disabled;
        if (!gestures[axisIndex].entity) input.value = String(point[axisIndex]);
      });
      remove.disabled = disabled || entity.geometrySpec.model.points.length <= (lathe ? 2 : 3);
    }
    presets.disabled = disabled;
    add.disabled = disabled || entity.geometrySpec.model.points.length >= info.maxPoints;
    if (model === drawnModel) return;
    drawnModel = model;
    const { outline, points } = model;
    const x = points.map((p) => p[0]);
    const y = points.map((p) => p[1]);
    const left = lathe ? 0 : Math.min(...x);
    const right = Math.max(...x);
    const bottom = Math.min(...y);
    const top = Math.max(...y);
    const pad = 0.15 * Math.max(right - left, top - bottom);
    const position = ([px, py]) => `${px},${-py}`;
    diagram.setAttribute('viewBox', `${left - pad} ${-top - pad} ${right - left + 2 * pad} ${top - bottom + 2 * pad}`);
    axis.setAttribute('visibility', lathe ? 'visible' : 'hidden');
    axis.setAttribute('x1', '0');
    axis.setAttribute('x2', '0');
    axis.setAttribute('y1', String(-top - pad));
    axis.setAttribute('y2', String(-bottom + pad));
    line.setAttribute('d', `M${outline.map(position).join('L')}${lathe ? '' : 'Z'}`);
    markers.setAttribute('d', points.map((point) => `M${position(point)}h0`).join(' '));
  }

  function changePoints(points, preview = false, scalar = {}) {
    const parameters = { ...entity.geometrySpec.parameters, ...scalar, ...encodeModelingPoints(points) };
    edit(entity, parameters, preview);
    sync();
  }

  for (let index = 0; index < info.maxPoints; index += 1) {
    const row = document.createElement('fieldset');
    const title = document.createElement('legend');
    title.textContent = `Ponto ${index + 1}`;
    row.append(title);
    const gestures = [];
    const inputs = (lathe ? ['Raio', 'Altura'] : ['X', 'Y']).map((name, axisIndex) => {
      const coordinate = document.createElement('label');
      coordinate.append(name);
      const input = document.createElement('input');
      input.className = 'geometry-select';
      input.type = 'number';
      input.inputMode = 'decimal';
      input.min = String(lathe && axisIndex === 0 ? 0 : -info.coordinateLimit);
      input.max = String(info.coordinateLimit);
      input.step = '0.0001';
      coordinate.append(input);
      row.append(coordinate);
      const change = (value, preview) => {
        const parsed = Number(value);
        if (value === '' || !Number.isFinite(parsed)) {
          cancelPreview(entity);
          sync();
          return;
        }
        const points = entity.geometrySpec.model.points.map((point, i) =>
          index === i ? point.map((v, axis) => axis === axisIndex ? parsed : v) : point);
        changePoints(points, preview);
      };
      gestures.push(bindLocalInput(input, {
        signal, getEntity,
        preview(value) { change(value, true); },
        restore(target, willCommit) {
          if (!willCommit) {
            cancelPreview(target);
            sync();
          }
        },
        commit(value) { change(value, false); },
      }));
      return input;
    });
    const remove = document.createElement('button');
    remove.type = 'button';
    remove.className = 'object-action';
    remove.textContent = 'Remover';
    remove.setAttribute('aria-label', `Remover ponto ${index + 1}`);
    remove.addEventListener('click', () => changePoints(entity.geometrySpec.model.points.filter((_, i) => i !== index)), { signal });
    row.append(remove);
    rows.push({ row, inputs, remove, gestures });
    pointsList.append(row);
  }
  add.addEventListener('click', () => {
    const points = [...entity.geometrySpec.model.points];
    let best = -Infinity;
    let index = 0;
    for (let i = 0; i < points.length - (lathe ? 1 : 0); i += 1) {
      const [x, y] = points[i];
      const [nx, ny] = points[(i + 1) % points.length];
      const length = lathe ? ny - y : Math.hypot(nx - x, ny - y);
      if (length > best) {
        best = length;
        index = i;
      }
    }
    const next = points[(index + 1) % points.length];
    points.splice(index + 1, 0, points[index].map((value, i) => (value + next[i]) / 2));
    changePoints(points);
  }, { signal });
  presets.addEventListener('change', () => {
    const preset = info.presets[presets.value];
    if (!preset) return;
    changePoints(preset.points, false, lathe ? {} : { rounded: Number(Boolean(preset.rounded)) });
    presets.value = '';
  }, { signal });

  return {
    sync(locked = disabled) {
      disabled = locked;
      sync();
    },
    cancel(id) {
      for (const { gestures } of rows) {
        for (const gesture of gestures) {
          if (id === undefined || gesture.entity?.id === id) gesture.cancel();
        }
      }
    },
  };
}
