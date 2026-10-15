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

  const material = new THREE.MeshStandardMaterial({
    color: SOLID_MATERIAL.color,
    roughness: 0.38,
    metalness: 0.12,
    wireframe: SOLID_MATERIAL.wireframe,
  });
  let currentShape = 'box';
  let object = new THREE.Mesh(createGeometry[currentShape](), material);
  object.position.y = 0.75;
  object.castShadow = true;
  object.receiveShadow = true;
  scene.add(object);
  let isRotating = false;
  let rotationSpeed = INITIAL_ROTATION_SPEED;
  let rotationAxis = INITIAL_ROTATION_AXIS;

  function selectObject(shape) {
    if (shape === currentShape) return;

    const geometryFactory = createGeometry[shape];
    if (!geometryFactory) {
      throw new Error(`Forma geométrica desconhecida: ${shape}`);
    }

    const nextObject = new THREE.Mesh(geometryFactory(), material);
    nextObject.position.y = shape === 'box' ? 0.75 : 0.85;
    nextObject.castShadow = true;
    nextObject.receiveShadow = true;

    scene.remove(object);
    object.geometry.dispose();
    scene.add(nextObject);
    object = nextObject;
    currentShape = shape;
  }

  function setColor(color) {
    material.color.set(color);
  }

  function setWireframe(wireframe) {
    material.wireframe = wireframe;
    material.needsUpdate = true;
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
    isRotating = !isRotating;
    return isRotating;
  }

  function setRotationSpeed(degreesPerSecond) {
    rotationSpeed = THREE.MathUtils.degToRad(degreesPerSecond);
  }

  function setRotationAxis(axis) {
    if (!['x', 'y', 'z'].includes(axis)) {
      throw new Error(`Eixo de rotação desconhecido: ${axis}`);
    }
    rotationAxis = axis;
  }

  function resetOrientation() {
    object.rotation.set(0, 0, 0);
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
    if (isRotating) {
      object.rotation[rotationAxis] += rotationSpeed * delta;
    }
    controls.update();
    renderer.render(scene, camera);
  }

  renderer.setAnimationLoop(render);
  return {
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
