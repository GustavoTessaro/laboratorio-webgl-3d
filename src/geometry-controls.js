import { bindLocalInput } from './edit-gestures.js';
import { geometries } from './graphics/geometries.js';
import { createModelingControls } from './modeling-controls.js';

const labels = {
  width: 'Largura', height: 'Altura', depth: 'Profundidade', radius: 'Raio',
  widthSegments: 'Segmentos horizontais', heightSegments: 'Segmentos verticais',
  depthSegments: 'Segmentos na profundidade', radiusTop: 'Raio superior', radiusBottom: 'Raio inferior',
  radialSegments: 'Segmentos radiais', tubularSegments: 'Segmentos ao longo do tubo',
  tube: 'Espessura (raio do tubo)', length: 'Comprimento sem as pontas',
  capSegments: 'Segmentos de cada ponta', detail: 'Detalhamento das faces', p: 'Voltas P', q: 'Voltas Q',
  startAngle: 'Ângulo inicial (°)', sweepAngle: 'Ângulo total (°)',
  curveSegments: 'Segmentos por curva', rounded: 'Arredondar cantos',
  bevelEnabled: 'Ativar chanfro', bevelThickness: 'Espessura do chanfro',
  bevelSize: 'Tamanho do chanfro', bevelSegments: 'Segmentos do chanfro',
};

function geometryHint(type) {
  switch (type) {
    case 'lathe': return 'Cada ponto informa raio e altura. A revolução gira o perfil em torno de Y, com 0° em +Z e ângulos positivos em direção a +X.';
    case 'extrude': return 'O contorno fechado no plano XY é extrudado ao longo de Z. O chanfro suaviza a transição entre as faces frontal e lateral. Arredondar cantos aproxima curvas quadráticas por segmentos.';
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
  let modelingControls;

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
    modelingControls?.cancel(entityId);
    for (const { gesture } of controls) {
      if (entityId === undefined || gesture?.entity?.id === entityId) gesture?.cancel();
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
      modelingControls = null;
      fields.replaceChildren();
      report();
      if (entity) renderFields(entity);
    }
    modelingControls?.sync(disabled);
    for (const { key, input, output, gesture, label } of controls) {
      input.disabled = disabled;
      if (disabled) gesture?.cancel();
      const p = entity.geometrySpec.parameters;
      label.hidden = (key === 'curveSegments' && !p.rounded) ||
        (['bevelThickness', 'bevelSize', 'bevelSegments'].includes(key) && !p.bevelEnabled);
      if (!gesture?.entity) {
        if (input.type === 'checkbox') input.checked = Boolean(p[key]);
        else {
          input.value = String(p[key]);
          output.value = numberFormat.format(Number(input.value));
        }
      }
    }
  }

  function edit(target, parameters, preview) {
    try {
      scene.setGeometry(target, target.type, parameters, preview);
      report();
    } catch (error) {
      scene.cancelGeometryPreview(target);
      report(error.message);
    }
  }

  function renderFields(entity) {
    const hint = document.createElement('p');
    hint.className = 'geometry-description';
    hint.textContent = geometryHint(entity.type);
    fields.append(hint);
    const { parameters, modeling } = geometries[entity.type];
    if (modeling) modelingControls = createModelingControls(fields, entity, modeling, {
      edit, cancelPreview: scene.cancelGeometryPreview, getEntity: scene.getSelectedEntity, signal: fieldLifetime.signal,
    });
    for (const [key, [, min, max, step]] of Object.entries(parameters)) {
      const label = document.createElement('label');
      label.className = 'range-control';
      const row = document.createElement('span');
      row.className = 'range-label';
      const title = document.createElement('span');
      title.textContent = labels[key];
      const input = document.createElement('input');
      const toggle = key === 'rounded' || key === 'bevelEnabled';
      input.type = toggle ? 'checkbox' : 'range';
      input.min = String(min);
      input.max = String(max);
      input.step = String(step);
      input.dataset.geometryParameter = key;
      input.setAttribute('aria-label', labels[key]);
      const output = document.createElement('output');
      row.append(title);
      if (!toggle) row.append(output);
      label.append(row, input);
      fields.append(label);

      function apply(target, value, preview) {
        edit(target, { ...target.geometrySpec.overrides, [key]: Number(value) }, preview);
        modelingControls?.sync();
      }
      if (toggle) {
        input.addEventListener('change', () => {
          const target = scene.getSelectedEntity();
          if (!target) return;
          apply(target, input.checked, false);
          input.checked = Boolean(target.geometrySpec.parameters[key]);
        }, { signal: fieldLifetime.signal });
        controls.push({ key, input, label });
        continue;
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
            modelingControls?.sync();
          }
        },
        commit(value, target) {
          apply(target, value, false);
          scene.cancelGeometryPreview(target);
          input.value = String(target.geometrySpec.parameters[key]);
          output.value = numberFormat.format(Number(input.value));
        },
      });
      controls.push({ key, input, output, gesture, label });
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
