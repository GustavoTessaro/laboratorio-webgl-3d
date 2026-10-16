import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

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
  let selectedEntityId = null;
  let nextSpawnIndex = 0;
  let onSelectionChange = () => {};

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
    mesh.position.set(spawn.x, type === 'box' ? 0.75 : 0.85, spawn.z);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = {
      id,
      name: nextEntityName(type),
      type,
      mesh,
      color: OBJECT_COLOR,
      materialMode: 'solid',
      animation: {
        enabled: false,
        axis: INITIAL_ROTATION_AXIS,
        speed: INITIAL_ROTATION_SPEED,
      },
    };

    entities.set(id, entity);
    mesh.userData.entityId = id;
    scene.add(mesh);
    selectedEntityId = id;
    onSelectionChange(entity);
    return entity;
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
    entity.mesh.position.y = type === 'box' ? 0.75 : 0.85;
    entity.name = nextEntityName(type);
    entity.type = type;
    if (entity.id === selectedEntityId) onSelectionChange(entity);
  }

  function updateAnimations(delta) {
    for (const entity of entities.values()) {
      if (entity.animation.enabled) {
        entity.mesh.rotation[entity.animation.axis] +=
          THREE.MathUtils.degToRad(entity.animation.speed) * delta;
      }
    }
  }

  return {
    createEntity,
    setSelectionChangeHandler,
    getEntity,
    getEntities,
    getSelectedEntity,
    getSelectedEntityOrThrow,
    selectEntity,
    removeEntity,
    replaceGeometry,
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
  entityRegistry.setSelectionChangeHandler((entity) => {
    if (!entity) {
      selectionHelper.visible = false;
      return;
    }
    selectionHelper.setFromObject(entity.mesh);
    selectionHelper.visible = true;
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
      start?.pointerId === event.pointerId && !start.moved && activePointers.size === 1;
    activePointers.delete(event.pointerId);
    if (start?.pointerId === event.pointerId) pointerStart = null;
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
  }

  renderer.domElement.addEventListener('pointerdown', handlePointerDown);
  renderer.domElement.addEventListener('pointermove', handlePointerMove);
  renderer.domElement.addEventListener('pointerup', handlePointerUp);
  renderer.domElement.addEventListener('pointercancel', handlePointerCancel);

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

  const grid = new THREE.GridHelper(10, 20, '#68748a', '#343d4d');
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
    if (selectedEntity) selectionHelper.setFromObject(selectedEntity.mesh);
    controls.update();
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(render);
  return {
    ...entityRegistry,
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
