import { environments } from './graphics/environment-presets.js';

const icons = {
  geometry: 'M34 70V40l26-13 26 13v30L60 83zM34 40l26 14 26-14M60 54v29 M100 75l19-48 19 48z M168 51a20 20 0 1 0 40 0a20 20 0 1 0-40 0',
  materials: 'M38 51a22 22 0 1 0 44 0a22 22 0 1 0-44 0m11-6 7-8 M99 28h43v44H99zM99 43h43m-43 14h43m-29-29v44m15-44v44 M168 51a22 22 0 1 0 44 0a22 22 0 1 0-44 0m8 0h29',
  lighting: 'M99 18h42l11 20H88zM120 8v10M88 44 63 77m57-31v32m32-34 25 33M104 79l16-19 16 19z',
  motion: 'M38 60c0-44 38-38 80-10s78 37 82 0c4-40-51-45-85-24S40 94 38 60Zm135-34 15 0-6 13M58 52v11h11V52z',
  particles: 'M64 72q56 22 112 0M64 72q56-18 112 0M120 68Q110 20 84 45m36 23q10-48 36-23M120 56V20m-16 12v-1m-22 25v-1m55-23v-1m25 23v-1',
  modeling: 'M55 20h20c0 18 20 20 20 39 0 13-11 17-30 17s-30-4-30-17c0-19 20-21 20-39z M65 20v54m-27-14q27 11 54 0 M144 47l34-19 28 17-34 19zM144 47v19l28 16 34-19V45m-34 19v18',
  empty: 'M86 63h68M120 31v45m-21-1 42-29',
};

export function bindEnvironmentControls(root, { load, frame }, signal) {
  const select = root.querySelector('[data-environment-select]');
  const add = root.querySelector('[data-environment-add]');
  const replace = root.querySelector('[data-environment-replace]');
  const frameButton = root.querySelector('[data-environment-frame]');
  const dialog = root.querySelector('[data-environment-dialog]');
  const status = root.querySelector('[data-environment-status]');
  let busy = false;
  let installed = null;
  let requested;
  for (const preset of environments) {
    const option = root.ownerDocument.createElement('option');
    option.value = preset.id;
    option.textContent = preset.name;
    select.append(option);
  }
  const selected = () => environments.find((preset) => preset.id === select.value);
  function sync() {
    const preset = selected();
    add.hidden = Boolean(preset.replaceOnly);
    select.disabled = add.disabled = replace.disabled = busy;
    frameButton.disabled = busy || !installed;
    root.querySelector('[data-environment-icon]').setAttribute('d', icons[preset.icon]);
    root.querySelector('[data-environment-description]').textContent = preset.description;
    root.querySelector('[data-environment-objective]').textContent = preset.objective;
  }
  async function apply(preset, mode) {
    if (busy) return;
    busy = true;
    status.textContent = 'Aplicando ambiente…';
    sync();
    try {
      const ids = await load(preset, mode);
      installed = { preset, ids };
      status.textContent = `${preset.name} aplicado.`;
    } catch (error) {
      status.textContent = error.message;
    } finally {
      busy = false;
      sync();
    }
  }
  select.addEventListener('change', sync, { signal });
  add.addEventListener('click', () => void apply(selected(), 'add'), { signal });
  replace.addEventListener('click', () => {
    requested = selected();
    status.textContent = '';
    dialog.returnValue = 'cancel';
    dialog.showModal();
  }, { signal });
  dialog.addEventListener('close', () => {
    if (dialog.returnValue === 'replace') void apply(requested, 'replace');
    else status.textContent = 'Substituição cancelada.';
  }, { signal });
  frameButton.addEventListener('click', () => frame(installed.preset, installed.ids), { signal });
  sync();
}
