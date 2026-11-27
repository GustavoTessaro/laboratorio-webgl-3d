import { loadModelAsset } from './graphics/model-assets.js';
import { modelCatalog, modelLimits, PRIVATE_MODEL } from './graphics/model-settings.js';

const format = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function bindModelControls(root, { scene, library, allowsPrivate }, signal) {
  const file = root.querySelector('[data-model-file]');
  const select = root.querySelector('[data-model-example]');
  const load = root.querySelector('[data-model-load]');
  const cancelButton = root.querySelector('[data-model-cancel]');
  const restore = root.querySelector('[data-model-restore]');
  const status = root.querySelector('[data-model-status]');
  const info = root.querySelector('[data-model-info]');
  let pending;
  let parked = 0;
  let selected;

  for (const [id, item] of Object.entries(modelCatalog)) {
    const option = root.ownerDocument.createElement('option');
    option.value = id;
    option.textContent = item.name;
    select.append(option);
  }

  function sync() {
    const local = allowsPrivate();
    file.disabled = Boolean(pending || !local);
    load.disabled = Boolean(pending);
    cancelButton.hidden = !pending;
    restore.hidden = !local || !parked;
    const item = selected?.model;
    const example = modelCatalog[select.value];
    const details = item?.info ?? example;
    if (!details) return;
    info.textContent = [
      item?.name ?? example.name,
      `${format.format(details.bytes / 1024)} KiB`,
      `${details.meshes} malhas`, `${format.format(details.vertices)} vértices`, `${format.format(details.triangles)} triângulos`,
      `${details.materials} materiais`, `${details.textures} texturas`, 'Sem animações incorporadas',
      selected?.privateModel ? 'Arquivo particular, somente neste navegador' : 'Laboratório WebGL 3D · CC0 1.0',
    ].join(' · ');
  }

  function cancel(message = '') {
    if (!pending) return;
    pending.abort();
    pending = undefined;
    status.textContent = message;
    sync();
  }

  async function run(action) {
    cancel();
    const controller = new AbortController();
    pending = controller;
    status.textContent = 'Validando e carregando o modelo…';
    sync();
    try {
      const result = await action(controller.signal);
      controller.signal.throwIfAborted();
      status.textContent = `${result.name} adicionado à cena.`;
    } catch (error) {
      if (!controller.signal.aborted) status.textContent = error.message;
    } finally {
      if (pending === controller) {
        pending = undefined;
        sync();
      }
    }
  }

  file.addEventListener('change', () => {
    const input = file.files?.[0];
    file.value = '';
    if (!input || !allowsPrivate()) return;
    void run(async (loadSignal) => {
      if (input.size > modelLimits.fileBytes) throw new Error('O arquivo deve ter até 4 MiB.');
      const name = input.name.replace(/\.(gltf|glb)$/i, '').trim().slice(0, 64) || 'Modelo particular';
      const asset = await loadModelAsset(await input.arrayBuffer(), name, loadSignal);
      try {
        loadSignal.throwIfAborted();
        if (!allowsPrivate()) throw new Error('Arquivos particulares estão disponíveis somente no modo local.');
        return scene.createEntity(PRIVATE_MODEL, { modelAsset: asset });
      } finally {
        asset.release();
      }
    });
  }, { signal });
  select.addEventListener('change', () => { selected = null; sync(); }, { signal });
  load.addEventListener('click', () => {
    const type = select.value;
    void run(async (loadSignal) => {
      await library.load(type);
      loadSignal.throwIfAborted();
      return scene.createEntity(type);
    });
  }, { signal });
  cancelButton.addEventListener('click', () => cancel('Carregamento cancelado.'), { signal });
  restore.addEventListener('click', () => {
    parked = scene.setPrivateModelsVisible(true);
    status.textContent = parked ? `${parked} modelo(s) continuam reservados até haver espaço na cena.` : 'Modelos particulares restaurados.';
    sync();
  }, { signal });
  signal.addEventListener('abort', () => cancel(), { once: true });
  sync();
  return {
    cancel,
    sync(entity = selected) { selected = entity; sync(); },
    setParked(count) {
      parked = count;
      if (count) status.textContent = `${count} modelo(s) particular(es) ficam reservados no modo local.`;
      sync();
    },
  };
}
