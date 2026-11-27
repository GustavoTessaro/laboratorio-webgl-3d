import { bindLocalInput } from './edit-gestures.js';
import { shaderCatalog, shaderLabels, shaderParameters } from './graphics/shader-settings.js';
import { shaderSources } from './graphics/shader-sources.js';

export function bindShaderControls(root, scene, signal, update, report) {
  const document = root.ownerDocument;
  const panel = root.querySelector('[data-shader-panel]');
  const select = root.querySelector('[data-shader-select]');
  const description = root.querySelector('[data-shader-description]');
  const fields = root.querySelector('[data-shader-fields]');
  const reset = root.querySelector('[data-shader-reset]');
  const vertex = root.querySelector('[data-shader-source="vertexShader"]');
  const fragment = root.querySelector('[data-shader-source="fragmentShader"]');
  const controls = [];
  let selected;
  let displayed;
  for (const [id, preset] of Object.entries(shaderCatalog)) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = preset.name;
    select.append(option);
  }
  for (const [key, name] of Object.entries(shaderLabels)) {
    const label = document.createElement('label');
    const range = key !== 'colorB';
    label.className = range ? 'range-control' : 'custom-color-control';
    const row = document.createElement('span');
    const title = document.createElement('span');
    const output = document.createElement('output');
    title.textContent = name;
    row.className = 'range-label';
    row.append(title);
    if (range) row.append(output);
    const input = document.createElement('input');
    input.type = range ? 'range' : 'color';
    input.dataset.shaderParameter = key;
    input.setAttribute('aria-label', name);
    label.append(row, input);
    fields.append(label);
    function edit(value, entity, preview) {
      const shader = entity.materialSettings.shader;
      if (!shader) return;
      update(entity, { shader: { id: shader.id, parameters: {
        ...shader.parameters, [key]: range ? Number(value) : value,
      } } }, preview);
      if (preview && range) output.value = value;
    }
    const gesture = bindLocalInput(input, {
      signal,
      getEntity: scene.getSelectedEntity,
      preview: (value, entity) => edit(value, entity, true),
      commit: (value, entity) => edit(value, entity, false),
      restore(entity, willCommit) {
        if (!willCommit && entity.materialSettings.shader) {
          scene.setMaterialSettings(entity, entity.materialSettings, true);
          input.value = String(shaderParameters(entity.materialSettings.shader)[key] ?? '');
          if (range) output.value = input.value;
        }
      },
    });
    controls.push({ key, range, label, input, output, gesture });
  }
  select.addEventListener('change', () => {
    if (selected) update(selected, { shader: { id: select.value } });
  }, { signal });
  reset.addEventListener('click', () => {
    if (selected?.materialSettings.shader) update(selected, { shader: { id: selected.materialSettings.shader.id } });
  }, { signal });
  root.querySelector('[data-shader-copy]').addEventListener('click', async () => {
    try {
      await document.defaultView.navigator.clipboard.writeText(`// Vertex Shader\n${vertex.value}\n\n// Fragment Shader\n${fragment.value}`);
      report('Código GLSL copiado.');
    } catch {
      vertex.focus();
      vertex.select();
      report('Selecione e copie o código de cada estágio com o atalho do navegador.');
    }
  }, { signal });

  return {
    cancel(id) {
      for (const { gesture } of controls) if (id === undefined || gesture.entity?.id === id) gesture.cancel();
    },
    sync(entity, settings, disabled) {
      selected = entity;
      panel.hidden = settings.kind !== 'shader';
      if (panel.hidden) return;
      const { id } = settings.shader;
      const preset = shaderCatalog[id];
      const values = shaderParameters(settings.shader);
      select.value = id;
      select.disabled = reset.disabled = disabled;
      if (displayed !== id) {
        displayed = id;
        description.textContent = preset.description + (id === 'wave'
          ? ' A seleção e os auxiliares leem a malha original. A malha deformada fica sem projeção de sombra.'
          : '');
        vertex.value = shaderSources[id].vertexShader;
        fragment.value = shaderSources[id].fragmentShader;
      }
      for (const { key, range, label, input, output, gesture } of controls) {
        label.hidden = !Object.hasOwn(values, key);
        input.disabled = disabled || label.hidden;
        if (label.hidden) gesture.cancel();
        if (!label.hidden && !gesture.entity) {
          if (range) [, input.min, input.max, input.step] = preset.fields[key].map(String);
          input.value = String(values[key]);
          if (range) output.value = input.value;
        }
      }
    },
  };
}
