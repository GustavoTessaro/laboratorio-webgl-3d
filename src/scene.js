import * as THREE from 'three';
import { createEntityRegistry } from './graphics/entity-registry.js';
import { bindTransformEditing, createSceneControls, synchronizeTransformTarget } from './graphics/scene-controls.js';
import { createSceneLighting } from './graphics/scene-lighting.js';
import { createViewCamera } from './graphics/view-camera.js';
import { createCoordinateHelpers } from './graphics/coordinate-helpers.js';
import { createParticleSystem } from './graphics/particle-system.js';
import { createGraphicsInspector } from './graphics/graphics-inspector.js';
import { createTrajectoryHelper } from './graphics/trajectory-helper.js';
import { SOLID_MATERIAL } from './graphics/object-materials.js';

export { createEntityRegistry, bindTransformEditing, synchronizeTransformTarget };

const MAX_PIXEL_RATIO = 2;
const MAX_FRAME_DELTA = 0.05;

export function createScene(container, {
  renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false }),
} = {}) {
  const document = container.ownerDocument;
  const view = document.defaultView;
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#171c26');
  const entityPresence = new Map();
  const presenceLabels = new Map();
  const presenceBounds = new THREE.Box3();
  const presenceCenter = new THREE.Vector3();

  const cameraView = createViewCamera();

  renderer.setPixelRatio(Math.min(view.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.prepend(renderer.domElement);

  const { controls, transformControls, transformHelper } = createSceneControls(scene, cameraView.camera, renderer.domElement);
  cameraView.connect(controls, transformControls);
  const coordinates = createCoordinateHelpers(scene);

  const entityRegistry = createEntityRegistry(scene);
  entityRegistry.createEntity('box', {
    id: '00000000-0000-4000-8000-000000000001',
    name: 'Cubo 1',
    x: 0,
    z: 0,
  });
  const selectionHelper = new THREE.BoxHelper(
    entityRegistry.getSelectedEntityOrThrow().mesh,
    '#f3d38a',
  );
  selectionHelper.material.transparent = true;
  selectionHelper.material.opacity = 0.65;
  selectionHelper.material.depthTest = false;
  selectionHelper.material.depthWrite = false;
  selectionHelper.renderOrder = 1;
  selectionHelper.frustumCulled = false;
  scene.add(selectionHelper);
  let activeTransformMode = null;
  let transformSpace = 'world';
  let selectedEntityEditable = true;
  let orbitWasEnabled = controls.enabled;
  let gizmoPointerActive = false;
  let selectionChangeObserver = () => {};
  let collaborationHandlers = {};
  let applyingRemoteState = false;

  function removePresenceLabel(entityId) {
    const sprite = presenceLabels.get(entityId);
    if (sprite) {
      scene.remove(sprite);
      sprite.material.map?.dispose();
      sprite.material.dispose();
      presenceLabels.delete(entityId);
    }
    entityPresence.delete(entityId);
  }

  function updateEntityPresence(entityId, editingName = null, lastEditor = null) {
    const entity = entityRegistry.getEntity(entityId);
    if (!entity) {
      removePresenceLabel(entityId);
      return;
    }
    const presence = { editingName, lastEditor };
    entityPresence.set(entityId, presence);
    const label = editingName
      ? `Editando: ${editingName}`
      : lastEditor
        ? `Última edição: ${lastEditor}`
        : '';
    let sprite = presenceLabels.get(entityId);
    if (!label) {
      removePresenceLabel(entityId);
      return;
    }

    if (!sprite) {
      const canvas = document.createElement('canvas');
      canvas.width = 512;
      canvas.height = 72;
      const texture = new THREE.CanvasTexture(canvas);
      const material = new THREE.SpriteMaterial({
        map: texture,
        transparent: true,
        depthTest: false,
      });
      sprite = new THREE.Sprite(material);
      sprite.userData.labelCanvas = canvas;
      presenceLabels.set(entityId, sprite);
      scene.add(sprite);
    }

    const canvas = sprite.userData.labelCanvas;
    const context = canvas.getContext('2d');
    context.clearRect(0, 0, canvas.width, canvas.height);
    context.fillStyle = editingName ? 'rgba(42, 62, 105, 0.94)' : 'rgba(24, 31, 44, 0.9)';
    context.beginPath();
    context.roundRect(4, 4, 504, 64, 24);
    context.fill();
    context.fillStyle = '#f2f5ff';
    context.font = '600 27px sans-serif';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(label, 256, 37, 470);
    sprite.material.map.needsUpdate = true;
    sprite.scale.set(2.6, 0.38, 1);
  }

  function synchronizeSelectedEntity() {
    const entity = entityRegistry.getSelectedEntity();
    if (!selectedEntityEditable || transformEdit.entityId !== entity?.id) transformEdit.cancel();
    synchronizeTransformTarget(
      transformControls,
      selectedEntityEditable ? entity : null,
      activeTransformMode,
      transformSpace,
    );
    if (!entity) {
      selectionHelper.visible = false;
      return null;
    }

    selectionHelper.setFromObject(entity.mesh);
    selectionHelper.visible = true;
    return entity;
  }

  const transformEdit = bindTransformEditing(transformControls, entityRegistry, {
    onRejected() {
      container.dispatchEvent(new Event('trajectory-out-of-bounds', { bubbles: true }));
    },
    onStart(id) {
      orbitWasEnabled = controls.enabled;
      controls.enabled = false;
      gizmoPointerActive = true;
      collaborationHandlers.onEditStateChange?.(id, true);
    },
    onPreview(snapshot) {
      collaborationHandlers.onEntityChanged?.(snapshot, { continuous: true });
    },
    onEnd(id, snapshot) {
      controls.enabled = orbitWasEnabled;
      collaborationHandlers.onEditStateChange?.(id, false, snapshot);
    },
  });

  entityRegistry.setSelectionChangeHandler(() => {
    const selectedEntity = synchronizeSelectedEntity();
    selectionChangeObserver(selectedEntity);
  });

  entityRegistry.setMutationHandlers({
    onCreated: (snapshot) => {
      if (!applyingRemoteState) collaborationHandlers.onEntityCreated?.(snapshot);
    },
    onDeleted: (id) => {
      removePresenceLabel(id);
      if (!applyingRemoteState) collaborationHandlers.onEntityDeleted?.(id);
    },
    onChanged: (snapshot) => {
      if (!applyingRemoteState) collaborationHandlers.onEntityChanged?.(snapshot, { continuous: false });
    },
  });

  function setSelectionChangeHandler(handler) {
    selectionChangeObserver = handler;
    selectionChangeObserver(entityRegistry.getSelectedEntity());
  }

  function handleGizmoMouseDown() {
    gizmoPointerActive = true;
    pointerStart = null;
  }

  transformControls.addEventListener('mouseDown', handleGizmoMouseDown);

  const raycaster = new THREE.Raycaster();
  const normalizedPointer = new THREE.Vector2();
  const CLICK_MOVE_THRESHOLD = 6;
  const activePointers = new Set();
  let pointerStart = null;

  function handlePointerDown(event) {
    activePointers.add(event.pointerId);
    if (!event.isPrimary || event.button !== 0 || activePointers.size !== 1) {
      pointerStart = null;
      return;
    }
    pointerStart = {
      pointerId: event.pointerId,
      x: event.clientX,
      y: event.clientY,
      moved: false,
    };
  }

  function handlePointerMove(event) {
    if (pointerStart?.pointerId !== event.pointerId) return;
    if (
      Math.hypot(event.clientX - pointerStart.x, event.clientY - pointerStart.y) >
      CLICK_MOVE_THRESHOLD
    ) {
      pointerStart.moved = true;
    }
  }

  function handlePointerUp(event) {
    const start = pointerStart;
    const isClickCandidate =
      start?.pointerId === event.pointerId &&
      !start.moved &&
      activePointers.size === 1 &&
      !gizmoPointerActive;
    activePointers.delete(event.pointerId);
    if (start?.pointerId === event.pointerId) pointerStart = null;
    gizmoPointerActive = false;
    if (!isClickCandidate) return;

    const movedX = event.clientX - start.x;
    const movedY = event.clientY - start.y;
    if (Math.hypot(movedX, movedY) > CLICK_MOVE_THRESHOLD) return;

    const rect = renderer.domElement.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return;
    normalizedPointer.set(
      ((event.clientX - rect.left) / rect.width) * 2 - 1,
      -((event.clientY - rect.top) / rect.height) * 2 + 1,
    );
    const camera = cameraView.camera;
    camera.updateMatrixWorld();
    raycaster.setFromCamera(normalizedPointer, camera);
    const meshes = entityRegistry.getEntities().map((entity) => entity.mesh);
    const [intersection] = raycaster.intersectObjects(meshes, false);
    if (!intersection) return;

    const entity = entityRegistry.getEntity(intersection.object.userData.entityId);
    if (entity) entityRegistry.selectEntity(entity.id);
  }

  function handlePointerCancel(event) {
    transformEdit.cancel();
    activePointers.delete(event.pointerId);
    if (pointerStart?.pointerId === event.pointerId) pointerStart = null;
    gizmoPointerActive = false;
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown, { signal });
  renderer.domElement.addEventListener('pointermove', handlePointerMove, { signal });
  renderer.domElement.addEventListener('pointerup', handlePointerUp, { signal });
  renderer.domElement.addEventListener('pointercancel', handlePointerCancel, { signal });

  function setTransformMode(mode) {
    if (mode !== null && !['translate', 'rotate', 'scale'].includes(mode)) {
      throw new Error(`Modo de transformação desconhecido: ${mode}`);
    }
    transformEdit.cancel();
    activeTransformMode = mode;
    if (mode) transformControls.setMode(mode);
    synchronizeSelectedEntity();
    controls.enabled = gizmoPointerActive ? false : orbitWasEnabled;
  }

  function setSelectedEntityEditable(editable) {
    selectedEntityEditable = Boolean(editable);
    synchronizeSelectedEntity();
  }

  function setTransformSpace(space) {
    if (transformEdit.entityId || !['world', 'local'].includes(space)) return false;
    transformSpace = space;
    synchronizeSelectedEntity();
    return true;
  }

  function getTransformSpace() {
    return { preferred: transformSpace, effective: activeTransformMode === 'scale' ? 'local' : transformSpace,
      scaling: activeTransformMode === 'scale' };
  }

  function changeCamera(action, ...args) {
    if (transformEdit.entityId) return false;
    return action(...args);
  }

  function frameSelected() {
    const entity = entityRegistry.getSelectedEntity();
    return entity ? changeCamera(cameraView.frame, [entity.mesh]) : false;
  }

  function removeEntity(id) {
    if (transformEdit.entityId === id) transformEdit.cancel();
    if (transformControls.object?.userData.entityId === id) {
      transformControls.detach();
    }
    return entityRegistry.removeEntity(id);
  }

  function setCollaborationHandlers(handlers = {}) {
    collaborationHandlers = handlers;
  }

  function applySharedSnapshot(snapshots) {
    transformEdit.cancel();
    applyingRemoteState = true;
    try {
      for (const entityId of presenceLabels.keys()) removePresenceLabel(entityId);
      entityRegistry.replaceEntities(snapshots);
      for (const snapshot of snapshots) {
        if (snapshot.lastEditor) updateEntityPresence(snapshot.id, null, snapshot.lastEditor);
      }
    } finally {
      applyingRemoteState = false;
    }
  }

  function applySharedEntity(snapshot) {
    applyingRemoteState = true;
    try {
      const entity = entityRegistry.applyEntitySnapshot(snapshot);
      updateEntityPresence(entity.id, entityPresence.get(entity.id)?.editingName, snapshot.lastEditor);
      return entity;
    } finally {
      applyingRemoteState = false;
    }
  }

  function removeSharedEntity(id) {
    if (transformEdit.entityId === id) transformEdit.cancel();
    if (transformControls.object?.userData.entityId === id) transformControls.detach();
    applyingRemoteState = true;
    try {
      removePresenceLabel(id);
      return entityRegistry.removeRemoteEntity(id);
    } finally {
      applyingRemoteState = false;
    }
  }

  function selectObject(type) {
    return entityRegistry.replaceGeometry(entityRegistry.getSelectedEntityOrThrow(), type);
  }

  function setColor(color, entity = entityRegistry.getSelectedEntityOrThrow()) {
    entityRegistry.setAppearance(entity, `#${new THREE.Color(color).getHexString()}`);
  }

  function setWireframe(wireframe) {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entityRegistry.setAppearance(entity, entity.color, wireframe ? 'wireframe' : 'solid');
  }

  function resetAppearance() {
    entityRegistry.setAppearance(entityRegistry.getSelectedEntityOrThrow(), SOLID_MATERIAL.color, 'solid', null);
  }

  const lighting = createSceneLighting(scene, renderer.capabilities?.maxTextureSize);
  const context = renderer.getContext?.();
  const pointSizeLimit = context?.getParameter?.(context.ALIASED_POINT_SIZE_RANGE)?.[1];
  const particles = createParticleSystem(scene, pointSizeLimit, renderer.getPixelRatio?.());
  const inspector = createGraphicsInspector(scene, {
    renderer,
    readBaseTransform: entityRegistry.readBaseTransform,
    countObjects: entityRegistry.count,
    countParticles: particles.countVisible,
    countLights: lighting.countActive,
  });
  const trajectoryHelper = createTrajectoryHelper(scene, entityRegistry.readBaseTransform);

  function changeTrajectoryPlayback(action) {
    const entity = entityRegistry.getSelectedEntity();
    const motion = entity?.trajectoryMotion;
    if (!motion || entity.editingTransform) return;
    if (action === 'restart') motion.elapsed = 0;
    else {
      motion.paused = action === 'pause';
      if (!motion.paused && motion.settings.mode === 'once' && motion.elapsed === motion.settings.duration) {
        motion.elapsed = 0;
      }
    }
    entityRegistry.applyVisualPose(entity);
  }

  function toggleRotation() {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entityRegistry.setAnimation(entity, { enabled: !entity.animation.enabled });
    return entity.animation.enabled;
  }

  function setRotationSpeed(degreesPerSecond, entity = entityRegistry.getSelectedEntityOrThrow()) {
    entityRegistry.setAnimation(entity, { speed: degreesPerSecond });
  }

  function setRotationAxis(axis) {
    if (!['x', 'y', 'z'].includes(axis)) {
      throw new Error(`Eixo de rotação desconhecido: ${axis}`);
    }
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entityRegistry.setAnimation(entity, { axis });
  }

  function resetOrientation() {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    const before = entityRegistry.serializeEntity(entity.id);
    entityRegistry.restoreBase(entity);
    entity.mesh.rotation.set(0, 0, 0);
    const valid = entityRegistry.constrainEntity(entity);
    if (entity.trajectory?.enabled) entityRegistry.applyVisualPose(entity);
    if (!valid) throw new Error('A orientação restaurada faria a trajetória ultrapassar os limites da cena.');
    if (['x', 'y', 'z'].some((axis) => before.rotation[axis] !== 0)) {
      collaborationHandlers.onEntityChanged?.(entityRegistry.serializeEntity(entity.id), { continuous: false });
    }
  }

  function resizeRenderer() {
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    cameraView.resize(width, height);
    renderer.setSize(width, height, false);
  }

  const resizeObserver = new view.ResizeObserver(resizeRenderer);
  resizeObserver.observe(container);
  view.addEventListener('resize', resizeRenderer, { signal });
  resizeRenderer();

  const clock = new THREE.Clock();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clock.stop();
    } else {
      clock.start();
    }
  }, { signal });

  function render() {
    const delta = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
    entityRegistry.updateAnimations(delta);
    particles.update(delta);
    const selectedEntity = entityRegistry.getSelectedEntity();
    trajectoryHelper.update(selectedEntity);
    coordinates.update(selectedEntity?.mesh);
    if (selectedEntity) {
      selectionHelper.setFromObject(selectedEntity.mesh);
      transformHelper.updateMatrixWorld(true);
    }
    for (const [entityId, sprite] of presenceLabels) {
      const entity = entityRegistry.getEntity(entityId);
      if (!entity) continue;
      presenceBounds.setFromObject(entity.mesh);
      presenceBounds.getCenter(presenceCenter);
      sprite.position.set(presenceCenter.x, presenceBounds.max.y + 0.3, presenceCenter.z);
    }
    controls.update();
    inspector.beforeRender(selectedEntity);
    renderer.render(scene, cameraView.camera);
    inspector.afterRender(cameraView.camera);
  }

  renderer.setAnimationLoop(render);

  function dispose() {
    if (signal.aborted) return;
    lifetime.abort();
    renderer.setAnimationLoop(null);
    clock.stop();
    resizeObserver.disconnect();
    collaborationHandlers = {};
    selectionChangeObserver = () => {};
    transformEdit.dispose();
    transformControls.removeEventListener('mouseDown', handleGizmoMouseDown);
    transformControls.detach();
    transformControls.dispose();
    transformHelper.removeFromParent();
    controls.dispose();
    cameraView.dispose();
    coordinates.dispose();
    inspector.dispose();
    trajectoryHelper.dispose();
    for (const id of presenceLabels.keys()) removePresenceLabel(id);
    entityRegistry.dispose();
    selectionHelper.removeFromParent();
    selectionHelper.dispose();
    lighting.dispose();
    particles.dispose();
    renderer.dispose();
    renderer.forceContextLoss();
    renderer.domElement.remove();
  }

  return {
    ...entityRegistry,
    setSelectionChangeHandler,
    setCollaborationHandlers,
    getSharedEntities: entityRegistry.getSharedEntities,
    applySharedSnapshot,
    applySharedEntity,
    removeSharedEntity,
    setEntityPresence: updateEntityPresence,
    removeEntity,
    setTransformMode,
    setTransformSpace,
    getTransformSpace,
    getCameraState: cameraView.state,
    setCameraChangeHandler: cameraView.setChangeHandler,
    setCameraProjection: (projection) => changeCamera(cameraView.setProjection, projection),
    setCameraFov: (value) => changeCamera(cameraView.setFov, value),
    setCameraZoom: (value) => changeCamera(cameraView.setZoom, value),
    setCameraTarget: (axis, value) => changeCamera(cameraView.setTarget, axis, value),
    setCameraPreset: (name) => changeCamera(cameraView.preset, name),
    frameSelected,
    frameAll: () => changeCamera(cameraView.frame, entityRegistry.getEntities().map(({ mesh }) => mesh)),
    resetCamera: () => changeCamera(cameraView.reset),
    setCoordinateHelper: coordinates.setVisible,
    cancelTransformEdit: transformEdit.cancel,
    setSelectedEntityEditable,
    selectObject,
    setColor,
    setWireframe,
    resetAppearance,
    applyLighting: lighting.apply,
    setLightingHelper: lighting.setHelper,
    particles,
    inspector,
    setTrajectoryHelper: trajectoryHelper.setVisible,
    changeTrajectoryPlayback,
    toggleRotation,
    setRotationSpeed,
    setRotationAxis,
    resetOrientation,
    dispose,
  };
}
