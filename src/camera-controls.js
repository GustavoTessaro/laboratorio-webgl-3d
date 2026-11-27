const projectionHints = {
  perspective: 'Objetos distantes aparecem menores. Um campo de visão maior mostra uma área mais ampla.',
  orthographic: 'Objetos do mesmo tamanho aparecem iguais a qualquer distância. O zoom altera o recorte.',
};

const number = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 2 });

export function bindCameraControls(root, scene, signal) {
  const projection = root.querySelector('#camera-projection');
  const hint = root.querySelector('#camera-projection-hint');
  const fov = root.querySelector('#camera-fov');
  const zoom = root.querySelector('#camera-zoom');
  const fovGroup = root.querySelector('[data-camera-fov]');
  const zoomGroup = root.querySelector('[data-camera-zoom]');
  const fovValue = root.querySelector('output[for="camera-fov"]');
  const zoomValue = root.querySelector('output[for="camera-zoom"]');
  const position = root.querySelector('#camera-position');
  const targets = root.querySelectorAll('[data-camera-target]');
  const space = root.querySelector('#transform-space');
  const spaceStatus = root.querySelector('#transform-space-status');
  const message = root.querySelector('[data-camera-message]');
  const frameSelected = root.querySelector('[data-frame-selected]');

  function sync(state) {
    projection.value = state.projection;
    hint.textContent = projectionHints[state.projection];
    fovGroup.hidden = state.projection !== 'perspective';
    zoomGroup.hidden = state.projection !== 'orthographic';
    fov.value = String(state.fov);
    zoom.value = String(state.zoom);
    fovValue.value = `${number.format(state.fov)}°`;
    zoomValue.value = `${number.format(state.zoom)}×`;
    position.value = state.position.map((value, index) => `${'XYZ'[index]} ${number.format(value)}`).join(' · ');
    targets.forEach((input, index) => {
      if (root.ownerDocument.activeElement !== input) input.value = state.target[index].toFixed(2);
    });
  }

  function syncSpace() {
    const { preferred, effective, scaling } = scene.getTransformSpace();
    space.value = preferred;
    spaceStatus.textContent = scaling
      ? 'Em uso: locais. A escala segue os eixos do objeto no Three.js.'
      : `Em uso: ${effective === 'world' ? 'globais' : 'locais'}.`;
  }

  function run(action, unavailable = 'Conclua o arraste do gizmo antes de alterar a câmera.') {
    const accepted = action() !== false;
    message.hidden = accepted;
    message.textContent = accepted ? '' : unavailable;
    if (!accepted) sync(scene.getCameraState());
  }

  scene.setCameraChangeHandler(sync);
  projection.addEventListener('change', () => run(() => scene.setCameraProjection(projection.value)), { signal });
  fov.addEventListener('input', () => run(() => scene.setCameraFov(Number(fov.value))), { signal });
  zoom.addEventListener('input', () => run(() => scene.setCameraZoom(Number(zoom.value))), { signal });
  targets.forEach((input, index) => {
    input.addEventListener('change', () => {
      run(() => scene.setCameraTarget(input.dataset.cameraTarget, input.valueAsNumber));
      input.value = scene.getCameraState().target[index].toFixed(2);
    }, { signal });
    input.addEventListener('keydown', (event) => { if (event.key === 'Enter') input.blur(); }, { signal });
  });
  root.querySelectorAll('[data-camera-view]').forEach((button) => {
    button.addEventListener('click', () => run(() => scene.setCameraPreset(button.dataset.cameraView)), { signal });
  });
  root.querySelectorAll('[data-camera-axis]').forEach((input) => {
    input.addEventListener('change', () => scene.setCoordinateHelper(input.dataset.cameraAxis, input.checked), { signal });
  });
  frameSelected.addEventListener('click', () => run(scene.frameSelected), { signal });
  root.querySelector('[data-frame-all]').addEventListener('click', () => {
    run(scene.frameAll, 'A cena está vazia ou há um arraste do gizmo em andamento.');
  }, { signal });
  root.querySelector('[data-reset-camera]').addEventListener('click', () => run(scene.resetCamera), { signal });
  space.addEventListener('change', () => {
    scene.setTransformSpace(space.value);
    syncSpace();
  }, { signal });
  syncSpace();

  return {
    syncSpace,
    syncSelection(hasSelection) { frameSelected.disabled = !hasSelection; },
    dispose() { scene.setCameraChangeHandler(); },
  };
}
