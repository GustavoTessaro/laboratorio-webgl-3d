import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';

const MAX_PIXEL_RATIO = 2;
const OBJECT_COLOR = '#6c8cff';
const SOLID_MATERIAL = { color: OBJECT_COLOR, wireframe: false };
const INITIAL_LIGHTING = {
  ambientIntensity: 2,
  directionalIntensity: 3,
  directionalX: 4,
  directionalY: 7,
};
const MAX_FRAME_DELTA = 0.05;
const INITIAL_ROTATION_SPEED = 45;
const INITIAL_ROTATION_AXIS = 'y';
const WORKSPACE_LIMIT = 10;
const WORKSPACE_SIZE = WORKSPACE_LIMIT * 2;
const WORKSPACE_HEIGHT = 10;
const BOUNDS_EPSILON = 1e-6;
const MIN_OBJECT_SCALE = 0.2;
const MAX_OBJECT_SCALE = 3;

const createGeometry = {
  box: () => new THREE.BoxGeometry(1.5, 1.5, 1.5),
  sphere: () => new THREE.SphereGeometry(0.85, 32, 24),
  pyramid: () => new THREE.ConeGeometry(0.85, 1.7, 4),
  torus: () => new THREE.TorusGeometry(0.62, 0.23, 16, 48),
};

const geometryNames = {
  box: 'Cubo',
  sphere: 'Esfera',
  pyramid: 'Pirâmide',
  torus: 'Toroide',
};
const spawnCoordinates = [-3.5, -1.75, 0, 1.75, 3.5]
  .flatMap((z) => [-3.5, -1.75, 0, 1.75, 3.5].map((x) => ({ x, z })))
  .filter(({ x, z }) => x !== 0 || z !== 0);

export function synchronizeTransformTarget(transformControls, entity, mode) {
  if (!entity) {
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.getHelper().visible = false;
    return;
  }

  if (transformControls.object !== entity.mesh) {
    transformControls.detach();
    transformControls.attach(entity.mesh);
  }
  if (mode) transformControls.setMode(mode);
  transformControls.enabled = Boolean(mode);
  transformControls.getHelper().visible = Boolean(mode);
}

export function createEntityRegistry(scene) {
  const entities = new Map();
  const nameCounters = new Map();
  const entityBounds = new THREE.Box3();
  const entitySize = new THREE.Vector3();
  const positionCorrection = new THREE.Vector3();
  const minimumScale = new THREE.Vector3(
    MIN_OBJECT_SCALE,
    MIN_OBJECT_SCALE,
    MIN_OBJECT_SCALE,
  );
  const previousScale = new THREE.Vector3();
  const candidateScale = new THREE.Vector3();
  const interpolatedScale = new THREE.Vector3();
  const validScales = new Map();
  const validTransforms = new Map();
  let selectedEntityId = null;
  let nextSpawnIndex = 0;
  let onSelectionChange = () => {};
  let onEntityCreated = () => {};
  let onEntityDeleted = () => {};
  let onEntityChanged = () => {};
  let copiedProperties = null;

  function serializeEntity(entity) {
    const { mesh } = entity;
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      color: entity.color,
      materialMode: entity.materialMode,
      position: { x: mesh.position.x, y: mesh.position.y, z: mesh.position.z },
      rotation: { x: mesh.rotation.x, y: mesh.rotation.y, z: mesh.rotation.z },
      scale: { x: mesh.scale.x, y: mesh.scale.y, z: mesh.scale.z },
      animation: { ...entity.animation },
      lastEditor: entity.lastEditor ?? null,
    };
  }

  function constrainEntity(entity) {
    const { mesh } = entity;
    mesh.updateWorldMatrix(true, false);
    entityBounds.setFromObject(mesh);
    if (entityBounds.isEmpty()) return;

    if (
      !Number.isFinite(entityBounds.min.x) ||
      !Number.isFinite(entityBounds.min.y) ||
      !Number.isFinite(entityBounds.min.z) ||
      !Number.isFinite(entityBounds.max.x) ||
      !Number.isFinite(entityBounds.max.y) ||
      !Number.isFinite(entityBounds.max.z)
    ) {
      return;
    }

    entityBounds.getSize(entitySize);
    if (
      entitySize.x > WORKSPACE_SIZE + BOUNDS_EPSILON ||
      entitySize.y > WORKSPACE_HEIGHT + BOUNDS_EPSILON ||
      entitySize.z > WORKSPACE_SIZE + BOUNDS_EPSILON
    ) {
      const validTransform = validTransforms.get(entity.id);
      if (validTransform) {
        mesh.position.copy(validTransform.position);
        mesh.quaternion.copy(validTransform.quaternion);
        mesh.scale.copy(validTransform.scale);
        mesh.updateWorldMatrix(true, false);
      }
      return false;
    }

    positionCorrection.set(0, 0, 0);

    if (entityBounds.min.x < -WORKSPACE_LIMIT) {
      positionCorrection.x = -WORKSPACE_LIMIT - entityBounds.min.x;
    } else if (entityBounds.max.x > WORKSPACE_LIMIT) {
      positionCorrection.x = WORKSPACE_LIMIT - entityBounds.max.x;
    }

    if (entityBounds.min.y < 0) {
      positionCorrection.y = -entityBounds.min.y;
    } else if (entityBounds.max.y > WORKSPACE_HEIGHT) {
      positionCorrection.y = WORKSPACE_HEIGHT - entityBounds.max.y;
    }

    if (entityBounds.min.z < -WORKSPACE_LIMIT) {
      positionCorrection.z = -WORKSPACE_LIMIT - entityBounds.min.z;
    } else if (entityBounds.max.z > WORKSPACE_LIMIT) {
      positionCorrection.z = WORKSPACE_LIMIT - entityBounds.max.z;
    }

    if (positionCorrection.lengthSq() > 0) {
      mesh.position.add(positionCorrection);
      mesh.updateWorldMatrix(true, false);
    }
    entityBounds.setFromObject(mesh);
    if (
      entityBounds.min.x < -WORKSPACE_LIMIT - BOUNDS_EPSILON ||
      entityBounds.max.x > WORKSPACE_LIMIT + BOUNDS_EPSILON ||
      entityBounds.min.y < -BOUNDS_EPSILON ||
      entityBounds.max.y > WORKSPACE_HEIGHT + BOUNDS_EPSILON ||
      entityBounds.min.z < -WORKSPACE_LIMIT - BOUNDS_EPSILON ||
      entityBounds.max.z > WORKSPACE_LIMIT + BOUNDS_EPSILON
    ) {
      return false;
    }
    validTransforms.set(entity.id, {
      position: mesh.position.clone(),
      quaternion: mesh.quaternion.clone(),
      scale: mesh.scale.clone(),
    });
    return true;
  }

  function scaleFitsWorkspace(entity) {
    entity.mesh.updateWorldMatrix(true, false);
    entityBounds.setFromObject(entity.mesh);
    if (entityBounds.isEmpty()) return false;
    entityBounds.getSize(entitySize);
    return (
      entitySize.x <= WORKSPACE_SIZE + BOUNDS_EPSILON &&
      entitySize.y <= WORKSPACE_HEIGHT + BOUNDS_EPSILON &&
      entitySize.z <= WORKSPACE_SIZE + BOUNDS_EPSILON
    );
  }

  function constrainEntityScale(entity) {
    const { mesh } = entity;
    const stableScale = validScales.get(entity.id);
    if (!stableScale) return;

    previousScale.copy(stableScale);
    candidateScale.set(
      Number.isFinite(mesh.scale.x)
        ? THREE.MathUtils.clamp(mesh.scale.x, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
        : previousScale.x,
      Number.isFinite(mesh.scale.y)
        ? THREE.MathUtils.clamp(mesh.scale.y, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
        : previousScale.y,
      Number.isFinite(mesh.scale.z)
        ? THREE.MathUtils.clamp(mesh.scale.z, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
        : previousScale.z,
    );
    mesh.scale.copy(candidateScale);
    let baselineScale = previousScale;
    if (!scaleFitsWorkspace(entity)) {
      mesh.scale.copy(minimumScale);
      if (!scaleFitsWorkspace(entity)) {
        mesh.scale.copy(previousScale);
        constrainEntity(entity);
        stableScale.copy(mesh.scale);
        return false;
      }
      baselineScale = minimumScale;
    }
    previousScale.copy(baselineScale);
    mesh.scale.copy(candidateScale);

    if (!scaleFitsWorkspace(entity)) {
      let minimum = 0;
      let maximum = 1;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const factor = (minimum + maximum) / 2;
        interpolatedScale.lerpVectors(previousScale, candidateScale, factor);
        mesh.scale.copy(interpolatedScale);
        if (scaleFitsWorkspace(entity)) {
          minimum = factor;
        } else {
          maximum = factor;
        }
      }
      mesh.scale.copy(interpolatedScale.lerpVectors(previousScale, candidateScale, minimum));
    }

    if (!constrainEntity(entity)) {
      mesh.scale.copy(previousScale);
      constrainEntity(entity);
    }
    stableScale.copy(mesh.scale);
    return true;
  }

  function setSelectionChangeHandler(handler) {
    onSelectionChange = handler;
    onSelectionChange(getSelectedEntity());
  }

  function nextEntityName(type) {
    const number = (nameCounters.get(type) ?? 0) + 1;
    nameCounters.set(type, number);
    return `${geometryNames[type]} ${number}`;
  }

  function createEntity(type = 'box', position = null) {
    const geometryFactory = createGeometry[type];
    if (!geometryFactory) {
      throw new Error(`Forma geométrica desconhecida: ${type}`);
    }

    const spawn = position ?? spawnCoordinates[nextSpawnIndex % spawnCoordinates.length];
    if (!position) nextSpawnIndex += 1;
    const id = position?.id ?? crypto.randomUUID();
    if (entities.has(id)) throw new Error(`Já existe um objeto com o identificador ${id}.`);
    const geometry = geometryFactory();
    const material = new THREE.MeshStandardMaterial({
      color: OBJECT_COLOR,
      roughness: 0.38,
      metalness: 0.12,
      wireframe: SOLID_MATERIAL.wireframe,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(spawn.x, spawn.y ?? (type === 'box' ? 0.75 : 0.85), spawn.z);
    const requestedScale = position?.scale?.clone() ?? mesh.scale.clone();
    if (position?.rotation) mesh.rotation.copy(position.rotation);
    mesh.scale.copy(minimumScale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = {
      id,
      name: position?.name ?? nextEntityName(type),
      type,
      mesh,
      color: position?.color ?? OBJECT_COLOR,
      materialMode: position?.materialMode ?? 'solid',
      animation: position?.animation ? { ...position.animation } : {
        enabled: false,
        axis: INITIAL_ROTATION_AXIS,
        speed: INITIAL_ROTATION_SPEED,
      },
      lastEditor: position?.lastEditor ?? null,
    };
    material.color.set(entity.color);
    material.wireframe = entity.materialMode === 'wireframe';

    entities.set(id, entity);
    validScales.set(id, minimumScale.clone());
    mesh.userData.entityId = id;
    scene.add(mesh);
    constrainEntity(entity);
    mesh.scale.copy(requestedScale);
    constrainEntityScale(entity);
    selectedEntityId = id;
    onSelectionChange(entity);
    onEntityCreated(serializeEntity(entity));
    return entity;
  }

  function getDuplicatePosition(entity) {
    entity.mesh.updateWorldMatrix(true, false);
    entityBounds.setFromObject(entity.mesh);
    if (
      entityBounds.isEmpty() ||
      !Number.isFinite(entityBounds.min.x) ||
      !Number.isFinite(entityBounds.min.y) ||
      !Number.isFinite(entityBounds.min.z) ||
      !Number.isFinite(entityBounds.max.x) ||
      !Number.isFinite(entityBounds.max.y) ||
      !Number.isFinite(entityBounds.max.z) ||
      entityBounds.min.y < 0
    ) {
      return null;
    }

    const offsets = [
      [1.5, 0],
      [-1.5, 0],
      [0, 1.5],
      [0, -1.5],
      [0, 0],
    ];
    for (const [offsetX, offsetZ] of offsets) {
      if (
        entityBounds.min.x + offsetX >= -WORKSPACE_LIMIT &&
        entityBounds.max.x + offsetX <= WORKSPACE_LIMIT &&
        entityBounds.min.z + offsetZ >= -WORKSPACE_LIMIT &&
        entityBounds.max.z + offsetZ <= WORKSPACE_LIMIT
      ) {
        return {
          x: entity.mesh.position.x + offsetX,
          y: entity.mesh.position.y,
          z: entity.mesh.position.z + offsetZ,
        };
      }
    }
    return null;
  }

  function duplicateEntity(id) {
    const source = getEntity(id);
    if (!source) return null;
    const position = getDuplicatePosition(source);
    if (!position) return null;

    return createEntity(source.type, {
      ...position,
      scale: source.mesh.scale.clone(),
      rotation: source.mesh.rotation.clone(),
      color: source.color,
      materialMode: source.materialMode,
      animation: { ...source.animation },
    });
  }

  function copyEntityProperties(id) {
    const entity = getEntity(id);
    if (!entity) return false;

    copiedProperties = {
      color: entity.color,
      materialMode: entity.materialMode,
      scale: {
        x: entity.mesh.scale.x,
        y: entity.mesh.scale.y,
        z: entity.mesh.scale.z,
      },
      animation: { ...entity.animation },
    };
    return true;
  }

  function applyCopiedProperties(id) {
    const entity = getEntity(id);
    if (!entity || !copiedProperties) return false;

    entity.color = copiedProperties.color;
    entity.materialMode = copiedProperties.materialMode;
    entity.mesh.material.color.set(copiedProperties.color);
    entity.mesh.material.wireframe = copiedProperties.materialMode === 'wireframe';
    entity.mesh.material.needsUpdate = true;
    entity.mesh.scale.set(
      copiedProperties.scale.x,
      copiedProperties.scale.y,
      copiedProperties.scale.z,
    );
    entity.animation = { ...copiedProperties.animation };
    constrainEntityScale(entity);
    onSelectionChange(entity);
    onEntityChanged(serializeEntity(entity));
    return true;
  }

  function hasCopiedProperties() {
    return copiedProperties !== null;
  }

  function getEntity(id) {
    return entities.get(id) ?? null;
  }

  function getEntities() {
    return Array.from(entities.values());
  }

  function getSelectedEntity() {
    return getEntity(selectedEntityId);
  }

  function selectEntity(id) {
    if (!entities.has(id)) {
      throw new Error(`Objeto desconhecido: ${id}`);
    }
    selectedEntityId = id;
    const entity = entities.get(id);
    onSelectionChange(entity);
    return entity;
  }

  function getSelectedEntityOrThrow() {
    const entity = getSelectedEntity();
    if (!entity) {
      throw new Error('Não há objeto selecionado.');
    }
    return entity;
  }

  function removeEntity(id) {
    const entity = entities.get(id);
    if (!entity) return false;

    scene.remove(entity.mesh);
    entity.mesh.geometry.dispose();
    entity.mesh.material.dispose();
    entities.delete(id);
    validScales.delete(id);
    validTransforms.delete(id);
    onEntityDeleted(id);

    if (selectedEntityId === id) {
      selectedEntityId = entities.keys().next().value ?? null;
      onSelectionChange(getSelectedEntity());
    }
    return true;
  }

  function replaceGeometry(entity, type) {
    const geometryFactory = createGeometry[type];
    if (!geometryFactory) {
      throw new Error(`Forma geométrica desconhecida: ${type}`);
    }
    if (type === entity.type) return;

    const geometry = geometryFactory();
    entity.mesh.geometry.dispose();
    entity.mesh.geometry = geometry;
    entity.name = nextEntityName(type);
    entity.type = type;
    constrainEntityScale(entity);
    if (entity.id === selectedEntityId) onSelectionChange(entity);
    onEntityChanged(serializeEntity(entity));
  }

  function updateAnimations(delta) {
    for (const entity of entities.values()) {
      if (entity.animation.enabled) {
        entity.mesh.rotation[entity.animation.axis] +=
          THREE.MathUtils.degToRad(entity.animation.speed) * delta;
        constrainEntity(entity);
      }
    }
  }

  function setMutationHandlers(handlers = {}) {
    onEntityCreated = handlers.onCreated ?? (() => {});
    onEntityDeleted = handlers.onDeleted ?? (() => {});
    onEntityChanged = handlers.onChanged ?? (() => {});
  }

  function replaceEntities(snapshots) {
    for (const entity of entities.values()) {
      scene.remove(entity.mesh);
      entity.mesh.geometry.dispose();
      entity.mesh.material.dispose();
    }
    entities.clear();
    validScales.clear();
    validTransforms.clear();
    selectedEntityId = null;
    for (const snapshot of snapshots) {
      createEntity(snapshot.type, {
        id: snapshot.id,
        name: snapshot.name,
        x: snapshot.position.x,
        y: snapshot.position.y,
        z: snapshot.position.z,
        scale: new THREE.Vector3(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z),
        rotation: new THREE.Euler(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z),
        color: snapshot.color,
        materialMode: snapshot.materialMode,
        animation: snapshot.animation,
      });
      const entity = getEntity(snapshot.id);
      entity.lastEditor = snapshot.lastEditor ?? null;
    }
    selectedEntityId = entities.keys().next().value ?? null;
    onSelectionChange(getSelectedEntity());
  }

  function applyEntitySnapshot(snapshot) {
    let entity = getEntity(snapshot.id);
    if (!entity) {
      createEntity(snapshot.type, {
        id: snapshot.id,
        name: snapshot.name,
        x: snapshot.position.x,
        y: snapshot.position.y,
        z: snapshot.position.z,
        scale: new THREE.Vector3(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z),
        rotation: new THREE.Euler(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z),
        color: snapshot.color,
        materialMode: snapshot.materialMode,
        animation: snapshot.animation,
      });
      entity = getEntity(snapshot.id);
    } else {
      if (entity.type !== snapshot.type) {
        entity.mesh.geometry.dispose();
        entity.mesh.geometry = createGeometry[snapshot.type]();
      }
      entity.type = snapshot.type;
      entity.name = snapshot.name;
      entity.color = snapshot.color;
      entity.materialMode = snapshot.materialMode;
      entity.mesh.material.color.set(snapshot.color);
      entity.mesh.material.wireframe = snapshot.materialMode === 'wireframe';
      entity.mesh.material.needsUpdate = true;
      entity.mesh.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
      entity.mesh.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
      entity.mesh.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
      entity.animation = { ...snapshot.animation };
      entity.lastEditor = snapshot.lastEditor ?? null;
      validScales.set(entity.id, entity.mesh.scale.clone());
      constrainEntity(entity);
    }
    return entity;
  }

  function removeRemoteEntity(id) {
    const entity = entities.get(id);
    if (!entity) return false;
    const previousCreated = onEntityCreated;
    const previousDeleted = onEntityDeleted;
    onEntityCreated = () => {};
    onEntityDeleted = () => {};
    try {
      return removeEntity(id);
    } finally {
      onEntityCreated = previousCreated;
      onEntityDeleted = previousDeleted;
    }
  }

  function getSharedEntities() {
    return Array.from(entities.values(), serializeEntity);
  }

  return {
    createEntity,
    duplicateEntity,
    copyEntityProperties,
    applyCopiedProperties,
    hasCopiedProperties,
    setSelectionChangeHandler,
    getEntity,
    getEntities,
    getSelectedEntity,
    getSelectedEntityOrThrow,
    selectEntity,
    removeEntity,
    replaceGeometry,
    constrainEntity,
    constrainEntityScale,
    updateAnimations,
    setMutationHandlers,
    serializeEntity: (id) => {
      const entity = getEntity(id);
      return entity ? serializeEntity(entity) : null;
    },
    replaceEntities,
    applyEntitySnapshot,
    removeRemoteEntity,
    getSharedEntities,
  };
}

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#171c26');
  const entityPresence = new Map();
  const presenceLabels = new Map();
  const presenceBounds = new THREE.Box3();
  const presenceCenter = new THREE.Vector3();

  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
  camera.position.set(4, 3, 5);

  const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, MAX_PIXEL_RATIO));
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  container.prepend(renderer.domElement);

  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.8;
  controls.maxDistance = 30;
  controls.target.set(0, 0.5, 0);
  controls.cursor.set(0, 0.5, 0);
  controls.maxTargetRadius = Math.hypot(12, 11.5, 12);

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('translate');
  transformControls.setSpace('world');
  const transformHelper = transformControls.getHelper();
  transformHelper.visible = false;
  scene.add(transformHelper);

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
  let selectedEntityEditable = true;
  let orbitWasEnabled = controls.enabled;
  let gizmoPointerActive = false;
  let manuallyRotatedEntity = null;
  let resumeAutomaticRotation = false;
  let selectionChangeObserver = () => {};
  let collaborationHandlers = {};
  let applyingRemoteState = false;

  function notifyEntityChanged(entity, continuous = false) {
    if (applyingRemoteState) return;
    collaborationHandlers.onEntityChanged?.(entityRegistry.serializeEntity(entity.id), { continuous });
  }

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
    synchronizeTransformTarget(
      transformControls,
      selectedEntityEditable ? entity : null,
      activeTransformMode,
    );
    if (!entity) {
      selectionHelper.visible = false;
      return null;
    }

    selectionHelper.setFromObject(entity.mesh);
    selectionHelper.visible = true;
    return entity;
  }

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

  transformControls.addEventListener('dragging-changed', (event) => {
    if (event.value) {
      orbitWasEnabled = controls.enabled;
      controls.enabled = false;
      gizmoPointerActive = true;
      const entity = entityRegistry.getSelectedEntity();
      if (entity) collaborationHandlers.onEditStateChange?.(entity.id, true);
      if (activeTransformMode === 'rotate') {
        manuallyRotatedEntity = entityRegistry.getSelectedEntity();
        resumeAutomaticRotation = Boolean(manuallyRotatedEntity?.animation.enabled);
        if (manuallyRotatedEntity) manuallyRotatedEntity.animation.enabled = false;
      }
    } else {
      controls.enabled = orbitWasEnabled;
      const entity = entityRegistry.getSelectedEntity();
      if (entity) {
        collaborationHandlers.onEditStateChange?.(
          entity.id,
          false,
          entityRegistry.serializeEntity(entity.id),
        );
      }
      if (manuallyRotatedEntity && resumeAutomaticRotation) {
        manuallyRotatedEntity.animation.enabled = true;
      }
      manuallyRotatedEntity = null;
      resumeAutomaticRotation = false;
    }
  });
  transformControls.addEventListener('mouseDown', () => {
    gizmoPointerActive = true;
    pointerStart = null;
  });
  transformControls.addEventListener('objectChange', () => {
    const entity = entityRegistry.getSelectedEntity();
    if (!entity) return;
    if (activeTransformMode === 'scale') {
      entityRegistry.constrainEntityScale(entity);
    } else {
      entityRegistry.constrainEntity(entity);
    }
    notifyEntityChanged(entity, true);
  });

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
    raycaster.setFromCamera(normalizedPointer, camera);
    const meshes = entityRegistry.getEntities().map((entity) => entity.mesh);
    const [intersection] = raycaster.intersectObjects(meshes, false);
    if (!intersection) return;

    const entity = entityRegistry.getEntity(intersection.object.userData.entityId);
    if (entity) entityRegistry.selectEntity(entity.id);
  }

  function handlePointerCancel(event) {
    activePointers.delete(event.pointerId);
    if (pointerStart?.pointerId === event.pointerId) pointerStart = null;
    gizmoPointerActive = false;
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('pointercancel', handlePointerCancel);

  function setTransformMode(mode) {
    if (mode !== null && !['translate', 'rotate', 'scale'].includes(mode)) {
      throw new Error(`Modo de transformação desconhecido: ${mode}`);
    }
    activeTransformMode = mode;
    if (mode) transformControls.setMode(mode);
    synchronizeSelectedEntity();
    controls.enabled = gizmoPointerActive ? false : orbitWasEnabled;
  }

  function setSelectedEntityEditable(editable) {
    selectedEntityEditable = Boolean(editable);
    synchronizeSelectedEntity();
  }

  function removeEntity(id) {
    if (transformControls.object?.userData.entityId === id) {
      transformControls.detach();
    }
    return entityRegistry.removeEntity(id);
  }

  function setCollaborationHandlers(handlers = {}) {
    collaborationHandlers = handlers;
  }

  function applySharedSnapshot(snapshots) {
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
    entityRegistry.replaceGeometry(entityRegistry.getSelectedEntityOrThrow(), type);
  }

  function setColor(color) {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.color = `#${new THREE.Color(color).getHexString()}`;
    entity.mesh.material.color.set(color);
    notifyEntityChanged(entity);
  }

  function setWireframe(wireframe) {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.materialMode = wireframe ? 'wireframe' : 'solid';
    entity.mesh.material.wireframe = wireframe;
    entity.mesh.material.needsUpdate = true;
    notifyEntityChanged(entity);
  }

  function resetAppearance() {
    setColor(SOLID_MATERIAL.color);
    setWireframe(SOLID_MATERIAL.wireframe);
  }

  const grid = new THREE.GridHelper(WORKSPACE_SIZE, 40, '#68748a', '#343d4d');
  grid.position.y = 0;
  scene.add(grid);

  const ambientLight = new THREE.HemisphereLight(
    '#dce7ff',
    '#303747',
    INITIAL_LIGHTING.ambientIntensity,
  );
  scene.add(ambientLight);

  const keyLight = new THREE.DirectionalLight('#fff3dd', INITIAL_LIGHTING.directionalIntensity);
  keyLight.position.set(INITIAL_LIGHTING.directionalX, INITIAL_LIGHTING.directionalY, 5);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(1024, 1024);
  scene.add(keyLight);

  function setAmbientIntensity(intensity) {
    ambientLight.intensity = intensity;
  }

  function setDirectionalIntensity(intensity) {
    keyLight.intensity = intensity;
  }

  function setDirectionalX(x) {
    keyLight.position.x = x;
  }

  function setDirectionalY(y) {
    keyLight.position.y = y;
  }

  function resetLighting() {
    ambientLight.intensity = INITIAL_LIGHTING.ambientIntensity;
    keyLight.intensity = INITIAL_LIGHTING.directionalIntensity;
    keyLight.position.set(INITIAL_LIGHTING.directionalX, INITIAL_LIGHTING.directionalY, 5);
    return INITIAL_LIGHTING;
  }

  function toggleRotation() {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.animation.enabled = !entity.animation.enabled;
    notifyEntityChanged(entity);
    return entity.animation.enabled;
  }

  function setRotationSpeed(degreesPerSecond) {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.animation.speed = degreesPerSecond;
    notifyEntityChanged(entity);
  }

  function setRotationAxis(axis) {
    if (!['x', 'y', 'z'].includes(axis)) {
      throw new Error(`Eixo de rotação desconhecido: ${axis}`);
    }
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.animation.axis = axis;
    notifyEntityChanged(entity);
  }

  function resetOrientation() {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.mesh.rotation.set(0, 0, 0);
    entityRegistry.constrainEntity(entity);
    notifyEntityChanged(entity);
  }

  function resizeRenderer() {
    const { width, height } = container.getBoundingClientRect();
    if (width === 0 || height === 0) return;

    camera.aspect = width / height;
    camera.updateProjectionMatrix();
    renderer.setSize(width, height, false);
  }

  const resizeObserver = new ResizeObserver(resizeRenderer);
  resizeObserver.observe(container);
  window.addEventListener('resize', resizeRenderer);
  resizeRenderer();

  const clock = new THREE.Clock();
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) {
      clock.stop();
    } else {
      clock.start();
    }
  });

  function render() {
    const delta = Math.min(clock.getDelta(), MAX_FRAME_DELTA);
    entityRegistry.updateAnimations(delta);
    const selectedEntity = entityRegistry.getSelectedEntity();
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
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(render);
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
    setSelectedEntityEditable,
    selectObject,
    setColor,
    setWireframe,
    resetAppearance,
    setAmbientIntensity,
    setDirectionalIntensity,
    setDirectionalX,
    setDirectionalY,
    resetLighting,
    toggleRotation,
    setRotationSpeed,
    setRotationAxis,
    resetOrientation,
  };
}
