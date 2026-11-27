import { bindLocalInput } from './edit-gestures.js';
import {
  MATERIAL_DEFAULTS, MATERIAL_RANGES, TEXTURE_TRANSFORM, textureCatalog, textureUrl,
} from './graphics/object-materials.js';

const fields = [
  ['opacity', 'Opacidade'], ['side', 'Faces visíveis'], ['transparent', 'Forçar transparência'],
  ['roughness', 'Rugosidade', 'standard'], ['metalness', 'Metalicidade', 'standard'],
  ['shininess', 'Brilho especular', 'phong'], ['specular', 'Cor especular', 'phong'],
  ['emissive', 'Cor emissiva', 'lit'], ['emissiveIntensity', 'Intensidade emissiva', 'lit'],
];
const mapping = [
  ['repeatU', 'Repetição U'], ['repeatV', 'Repetição V'], ['offsetU', 'Deslocamento U'],
  ['offsetV', 'Deslocamento V'], ['textureRotation', 'Rotação (°)'],
];
const guidance = {
  basic: 'Basic mostra a cor e a textura sem responder à iluminação.',
  phong: 'Em Phong, brilho maior concentra o reflexo. A cor especular tinge esse reflexo.',
  standard: 'No PBR, a rugosidade espalha o reflexo e a metalicidade altera sua interação com a cor.',
};
const nf = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function bindMaterialControls(root, scene, signal, refresh) {
  const document = root.ownerDocument;
  const kind = root.querySelector('#material-kind');
  const materialFields = root.querySelector('[data-material-fields]');
  const textureFields = root.querySelector('[data-texture-fields]');
  const textureMapping = root.querySelector('[data-texture-mapping]');
  const textureOptions = root.querySelector('[data-texture-options]');
  const textureStatus = root.querySelector('[data-texture-status]');
  const reset = root.querySelector('[data-reset-texture]');
  const hint = document.createElement('p');
  hint.className = 'geometry-description';
  const opacityHint = document.createElement('p');
  opacityHint.className = 'geometry-description';
  opacityHint.textContent = 'Opacidade abaixo de 1 ativa a transparência. A emissão clareia a superfície.';
  materialFields.append(hint, opacityHint);
  let selected;
  const controls = [];

  function update(entity, changes) {
    scene.setMaterialSettings(entity, { ...entity.materialSettings, ...changes });
    refresh();
  }

  function addField(group, [key, name, context]) {
    const label = document.createElement('label');
    const title = document.createElement('span');
    title.textContent = name;
    const limits = MATERIAL_RANGES[key];
    const input = document.createElement(key === 'side' ? 'select' : 'input');
    input.dataset.materialProperty = key;
    const output = document.createElement('output');
    let gesture;
    if (key === 'side') {
      input.className = 'geometry-select';
      for (const [value, text] of [['front', 'Frontal'], ['back', 'Traseira'], ['double', 'Dupla']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = text;
        input.append(option);
      }
      label.className = 'geometry-field material-field';
      label.append(title, input);
    } else if (key === 'transparent') {
      input.type = 'checkbox';
      label.className = 'custom-color-control';
      label.title = 'Opacidade menor que 1 já ativa a transparência automaticamente.';
      label.append(title, input);
    } else {
      const line = document.createElement('span');
      line.className = 'range-label';
      input.type = limits ? 'range' : 'color';
      label.className = limits ? 'range-control' : 'custom-color-control';
      if (limits) {
        [input.min, input.max, input.step] = limits.map(String);
        line.append(title, output);
        label.append(line, input);
      } else label.append(title, input);

      const parse = limits ? Number : (value) => value;
      gesture = bindLocalInput(input, {
        signal,
        getEntity: scene.getSelectedEntity,
        preview(value, entity) {
          if (limits) output.value = nf.format(Number(value));
          scene.setMaterialSettings(entity, { ...entity.materialSettings, [key]: parse(value) }, true);
        },
        restore(entity, willCommit) {
          if (!willCommit) {
            scene.setMaterialSettings(entity, entity.materialSettings, true);
            showValue(entity.materialSettings);
          }
        },
        commit(value, entity) { update(entity, { [key]: parse(value) }); },
      });
    }
    function showValue(settings) {
      if (key === 'transparent') input.checked = settings[key];
      else input.value = String(settings[key]);
      if (limits) output.value = nf.format(settings[key]);
    }
    if (!gesture) input.addEventListener('change', () => {
      if (selected) update(selected, { [key]: key === 'transparent' ? input.checked : input.value });
    }, { signal });
    controls.push({ label, input, context, gesture, showValue });
    group.append(label);
  }

  fields.forEach((field) => addField(materialFields, field));
  mapping.forEach((field) => addField(textureFields, [...field, 'texture']));
  const textureButtons = [null, ...Object.keys(textureCatalog)].map((id) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'texture-option';
    button.dataset.textureId = id ?? '';
    if (id) {
      const image = document.createElement('img');
      image.src = textureUrl(id);
      image.alt = '';
      image.loading = 'lazy';
      button.append(image);
    }
    const name = document.createElement('span');
    name.textContent = id ? textureCatalog[id].name : 'Sem textura';
    button.append(name);
    button.addEventListener('click', () => {
      if (selected) update(selected, { textureId: id });
    }, { signal });
    return { id, button };
  });
  textureOptions.replaceChildren(...textureButtons.map(({ button }) => button));
  kind.addEventListener('change', () => {
    if (selected) update(selected, { kind: kind.value });
  }, { signal });
  reset.addEventListener('click', () => {
    if (selected) update(selected, TEXTURE_TRANSFORM);
  }, { signal });

  function cancel(id) {
    for (const { gesture } of controls) {
      if (gesture?.entity && (id === undefined || gesture.entity.id === id)) gesture.cancel();
    }
  }

  function showTextureStatus() {
    const failed = selected?.mesh.userData?.textureStatus === 'error';
    textureStatus.hidden = !failed;
    textureStatus.textContent = failed ? 'A imagem falhou ao carregar. A cor do objeto continua visível.' : '';
  }
  signal.addEventListener('abort', () => {
    selected?.mesh.removeEventListener?.('texture-status', showTextureStatus);
  }, { once: true });

  return {
    cancel,
    sync(entity, locked) {
      if (entity !== selected || locked) cancel();
      if (entity !== selected) {
        selected?.mesh.removeEventListener?.('texture-status', showTextureStatus);
        entity?.mesh.addEventListener?.('texture-status', showTextureStatus);
      }
      selected = entity;
      const settings = entity?.materialSettings ?? MATERIAL_DEFAULTS;
      const disabled = !entity || locked;
      kind.value = settings.kind;
      kind.disabled = reset.disabled = disabled;
      hint.textContent = guidance[settings.kind];
      textureMapping.hidden = !settings.textureId;
      for (const { id, button } of textureButtons) {
        button.disabled = disabled;
        button.setAttribute('aria-pressed', String(settings.textureId === id));
      }
      for (const { label, input, context, gesture, showValue } of controls) {
        label.hidden = context === 'lit' ? settings.kind === 'basic'
          : context === 'texture' ? !settings.textureId : Boolean(context && context !== settings.kind);
        input.disabled = disabled || label.hidden;
        if (label.hidden) gesture?.cancel();
        if (!gesture?.entity) showValue(settings);
      }
      showTextureStatus();
    },
  };
}
