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

export function createEntityRegistry(scene) {
  const entities = new Map();
  const nameCounters = new Map();
  const entityBounds = new THREE.Box3();
  const entitySize = new THREE.Vector3();
  const entityCenter = new THREE.Vector3();
  const positionCorrection = new THREE.Vector3();
  const previousScale = new THREE.Vector3();
  const candidateScale = new THREE.Vector3();
  const interpolatedScale = new THREE.Vector3();
  const validScales = new Map();
  let selectedEntityId = null;
  let nextSpawnIndex = 0;
  let onSelectionChange = () => {};
  let copiedProperties = null;

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
    entityBounds.getCenter(entityCenter);
    positionCorrection.set(0, 0, 0);

    if (entitySize.x > WORKSPACE_SIZE) {
      positionCorrection.x = -entityCenter.x;
    } else if (entityBounds.min.x < -WORKSPACE_LIMIT) {
      positionCorrection.x = -WORKSPACE_LIMIT - entityBounds.min.x;
    } else if (entityBounds.max.x > WORKSPACE_LIMIT) {
      positionCorrection.x = WORKSPACE_LIMIT - entityBounds.max.x;
    }

    if (entityBounds.min.y < 0) {
      positionCorrection.y = -entityBounds.min.y;
    }

    if (entitySize.z > WORKSPACE_SIZE) {
      positionCorrection.z = -entityCenter.z;
    } else if (entityBounds.min.z < -WORKSPACE_LIMIT) {
      positionCorrection.z = -WORKSPACE_LIMIT - entityBounds.min.z;
    } else if (entityBounds.max.z > WORKSPACE_LIMIT) {
      positionCorrection.z = WORKSPACE_LIMIT - entityBounds.max.z;
    }

    if (positionCorrection.lengthSq() > 0) {
      mesh.position.add(positionCorrection);
      mesh.updateWorldMatrix(true, false);
    }
  }

  function scaleFitsWorkspace(entity) {
    entity.mesh.updateWorldMatrix(true, false);
    entityBounds.setFromObject(entity.mesh);
    if (entityBounds.isEmpty()) return false;
    entityBounds.getSize(entitySize);
    return entitySize.x <= WORKSPACE_SIZE && entitySize.z <= WORKSPACE_SIZE;
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

    constrainEntity(entity);
    stableScale.copy(mesh.scale);
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
    const id = crypto.randomUUID();
    const geometry = geometryFactory();
    const material = new THREE.MeshStandardMaterial({
      color: OBJECT_COLOR,
      roughness: 0.38,
      metalness: 0.12,
      wireframe: SOLID_MATERIAL.wireframe,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.set(spawn.x, spawn.y ?? (type === 'box' ? 0.75 : 0.85), spawn.z);
    if (position?.scale) mesh.scale.copy(position.scale);
    if (position?.rotation) mesh.rotation.copy(position.rotation);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = {
      id,
      name: nextEntityName(type),
      type,
      mesh,
      color: position?.color ?? OBJECT_COLOR,
      materialMode: position?.materialMode ?? 'solid',
      animation: position?.animation ? { ...position.animation } : {
        enabled: false,
        axis: INITIAL_ROTATION_AXIS,
        speed: INITIAL_ROTATION_SPEED,
      },
    };
    material.color.set(entity.color);
    material.wireframe = entity.materialMode === 'wireframe';

    entities.set(id, entity);
    validScales.set(id, mesh.scale.clone());
    mesh.userData.entityId = id;
    scene.add(mesh);
    constrainEntity(entity);
    selectedEntityId = id;
    onSelectionChange(entity);
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
  };
}

export function createScene(container) {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color('#171c26');

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
  controls.minDistance = 2.5;
  controls.maxDistance = 12;
  controls.target.set(0, 0.5, 0);

  const transformControls = new TransformControls(camera, renderer.domElement);
  transformControls.setMode('translate');
  transformControls.setSpace('world');
  const transformHelper = transformControls.getHelper();
  transformHelper.visible = false;
  scene.add(transformHelper);

  const entityRegistry = createEntityRegistry(scene);
  entityRegistry.createEntity('box', { x: 0, z: 0 });
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
  let orbitWasEnabled = controls.enabled;
  let gizmoPointerActive = false;
  let manuallyRotatedEntity = null;
  let resumeAutomaticRotation = false;
  entityRegistry.setSelectionChangeHandler((entity) => {
    if (!entity) {
      transformControls.detach();
      transformHelper.visible = false;
      selectionHelper.visible = false;
      return;
    }
    transformControls.attach(entity.mesh);
    transformHelper.visible = Boolean(activeTransformMode);
    selectionHelper.setFromObject(entity.mesh);
    selectionHelper.visible = true;
  });

  transformControls.addEventListener('dragging-changed', (event) => {
    if (event.value) {
      orbitWasEnabled = controls.enabled;
      controls.enabled = false;
      gizmoPointerActive = true;
      if (activeTransformMode === 'rotate') {
        manuallyRotatedEntity = entityRegistry.getSelectedEntity();
        resumeAutomaticRotation = Boolean(manuallyRotatedEntity?.animation.enabled);
        if (manuallyRotatedEntity) manuallyRotatedEntity.animation.enabled = false;
      }
    } else {
      controls.enabled = orbitWasEnabled;
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
    transformControls.enabled = Boolean(mode);
    transformHelper.visible = Boolean(mode && entityRegistry.getSelectedEntity());
    controls.enabled = gizmoPointerActive ? false : orbitWasEnabled;
  }

  function removeEntity(id) {
    if (transformControls.object?.userData.entityId === id) {
      transformControls.detach();
    }
    return entityRegistry.removeEntity(id);
  }

  function selectObject(type) {
    entityRegistry.replaceGeometry(entityRegistry.getSelectedEntityOrThrow(), type);
  }

  function setColor(color) {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.color = `#${new THREE.Color(color).getHexString()}`;
    entity.mesh.material.color.set(color);
  }

  function setWireframe(wireframe) {
    const entity = entityRegistry.getSelectedEntityOrThrow();
    entity.materialMode = wireframe ? 'wireframe' : 'solid';
    entity.mesh.material.wireframe = wireframe;
    entity.mesh.material.needsUpdate = true;
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
    return entity.animation.enabled;
  }

  function setRotationSpeed(degreesPerSecond) {
    entityRegistry.getSelectedEntityOrThrow().animation.speed = degreesPerSecond;
  }

  function setRotationAxis(axis) {
    if (!['x', 'y', 'z'].includes(axis)) {
      throw new Error(`Eixo de rotação desconhecido: ${axis}`);
    }
    entityRegistry.getSelectedEntityOrThrow().animation.axis = axis;
  }

  function resetOrientation() {
    entityRegistry.getSelectedEntityOrThrow().mesh.rotation.set(0, 0, 0);
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
    controls.update();
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(render);
  return {
    ...entityRegistry,
    removeEntity,
    setTransformMode,
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
