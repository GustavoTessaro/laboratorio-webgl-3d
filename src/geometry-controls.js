import { bindLocalInput } from './edit-gestures.js';
import { geometries } from './graphics/geometries.js';

const labels = {
  width: 'Largura', height: 'Altura', depth: 'Profundidade', radius: 'Raio',
  widthSegments: 'Segmentos horizontais', heightSegments: 'Segmentos verticais',
  depthSegments: 'Segmentos na profundidade', radiusTop: 'Raio superior', radiusBottom: 'Raio inferior',
  radialSegments: 'Segmentos radiais', tubularSegments: 'Segmentos ao longo do tubo',
  tube: 'Espessura (raio do tubo)', length: 'Comprimento sem as pontas',
  capSegments: 'Segmentos de cada ponta', detail: 'Detalhamento das faces', p: 'Voltas P', q: 'Voltas Q',
};

function geometryHint(type) {
  switch (type) {
    case 'pyramid': return 'A base da pirâmide tem sempre quatro lados.';
    case 'plane': return 'A malha começa no plano XY e tem uma face visível.';
    case 'capsule': return 'O comprimento mede a parte reta. As duas pontas somam dois raios.';
    case 'torusKnot': return 'P e Q controlam as voltas da curva em torno do eixo e do tubo imaginário.';
    default: return 'Mais segmentos ou maior detalhamento aumentam o número de faces da malha.';
  }
}

const numberFormat = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function bindGeometryControls(root, scene, signal) {
  const document = root.ownerDocument;
  const add = root.querySelector('#add-object-shape');
  const shape = root.querySelector('#object-shape');
  const fields = root.querySelector('[data-geometry-fields]');
  const reset = root.querySelector('[data-reset-geometry]');
  const message = root.querySelector('[data-geometry-message]');
  let fieldLifetime = new AbortController();
  let renderedEntity;
  let renderedType;
  let controls = [];

  for (const select of [add, shape]) {
    select.replaceChildren(...Object.entries(geometries).map(([type, { name }]) => {
      const option = document.createElement('option');
      option.value = type;
      option.textContent = name;
      return option;
    }));
  }

  function report(text = '') {
    message.textContent = text;
    message.hidden = !text;
  }

  function attempt(action) {
    try {
      action();
      report();
    } catch (error) {
      report(error.message);
    }
  }

  function cancel(entityId) {
    for (const { gesture } of controls) {
      if (entityId === undefined || gesture.entity?.id === entityId) gesture.cancel();
    }
  }

  function sync(entity, locked) {
    const disabled = !entity || locked;
    shape.disabled = reset.disabled = disabled;
    shape.value = entity?.type ?? '';
    if (renderedEntity !== entity || renderedType !== entity?.type) {
      cancel();
      fieldLifetime.abort();
      fieldLifetime = new AbortController();
      renderedEntity = entity;
      renderedType = entity?.type;
      controls = [];
      fields.replaceChildren();
      report();
      if (entity) renderFields(entity);
    }
    for (const { key, input, output, gesture } of controls) {
      input.disabled = disabled;
      if (disabled) gesture.cancel();
      if (!gesture.entity) {
        input.value = String(entity.geometrySpec.parameters[key]);
        output.value = numberFormat.format(Number(input.value));
      }
    }
  }

  function renderFields(entity) {
    const hint = document.createElement('p');
    hint.className = 'geometry-description';
    hint.textContent = geometryHint(entity.type);
    fields.append(hint);
    for (const [key, [, min, max, step]] of Object.entries(geometries[entity.type].parameters)) {
      const label = document.createElement('label');
      label.className = 'range-control';
      const row = document.createElement('span');
      row.className = 'range-label';
      const title = document.createElement('span');
      title.textContent = labels[key];
      const input = document.createElement('input');
      input.type = 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.dataset.geometryParameter = key;
      input.setAttribute('aria-label', labels[key]);
      const output = document.createElement('output');
      row.append(title, output);
      label.append(row, input);
      fields.append(label);

      function apply(target, value, preview) {
        const parameters = { ...target.geometrySpec.parameters, [key]: Number(value) };
        attempt(() => scene.setGeometry(target, target.type, parameters, preview));
      }
      const gesture = bindLocalInput(input, {
        signal: fieldLifetime.signal,
        getEntity: scene.getSelectedEntity,
        preview(value, target) {
          output.value = numberFormat.format(Number(value));
          apply(target, value, true);
        },
        restore(target, willCommit) {
          if (!willCommit) {
            scene.cancelGeometryPreview(target);
            input.value = String(target.geometrySpec.parameters[key]);
            output.value = numberFormat.format(Number(input.value));
            report();
          }
        },
        commit(value, target) {
          apply(target, value, false);
          scene.cancelGeometryPreview(target);
          input.value = String(target.geometrySpec.parameters[key]);
          output.value = numberFormat.format(Number(input.value));
        },
      });
      controls.push({ key, input, output, gesture });
    }
  }

  root.querySelector('[data-add-object]').addEventListener('click', () => scene.createEntity(add.value), { signal });
  shape.addEventListener('change', () => {
    cancel();
    attempt(() => scene.selectObject(shape.value));
    shape.value = scene.getSelectedEntity()?.type ?? '';
  }, { signal });
  reset.addEventListener('click', () => {
    cancel();
    const entity = scene.getSelectedEntity();
    if (entity) attempt(() => scene.setGeometry(entity, entity.type, null));
  }, { signal });

  return {
    sync,
    cancel,
    dispose() {
      cancel();
      fieldLifetime.abort();
    },
  };
}
