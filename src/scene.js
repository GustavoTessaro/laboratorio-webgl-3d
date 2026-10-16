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

export function createEntityRegistry(scene) {
  const entities = new Map();
  let selectedEntityId = null;

  function createEntity(type = 'box') {
    const geometryFactory = createGeometry[type];
    if (!geometryFactory) {
      throw new Error(`Forma geométrica desconhecida: ${type}`);
    }

    const id = crypto.randomUUID();
    const geometry = geometryFactory();
    const material = new THREE.MeshStandardMaterial({
      color: OBJECT_COLOR,
      roughness: 0.38,
      metalness: 0.12,
      wireframe: SOLID_MATERIAL.wireframe,
    });
    const mesh = new THREE.Mesh(geometry, material);
    mesh.position.y = type === 'box' ? 0.75 : 0.85;
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = {
      id,
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
    scene.add(mesh);
    selectedEntityId = id;
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
    return entities.get(id);
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
    entity.type = type;
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
  entityRegistry.createEntity('box');

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
