import * as THREE from 'three';

export const SOLID_MATERIAL = { color: '#6c8cff', wireframe: false };
const INITIAL_LIGHTING = {
  ambientIntensity: 2,
  directionalIntensity: 3,
  directionalX: 4,
  directionalY: 7,
};
export const WORKSPACE_LIMIT = 10;
export const WORKSPACE_SIZE = WORKSPACE_LIMIT * 2;
export const WORKSPACE_HEIGHT = 10;
export const BOUNDS_EPSILON = 1e-6;

export function createObjectMaterial() {
  return new THREE.MeshStandardMaterial({
    ...SOLID_MATERIAL,
    roughness: 0.38,
    metalness: 0.12,
  });
}

export function createLighting(scene) {
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

  return {
    setAmbientIntensity,
    setDirectionalIntensity,
    setDirectionalX,
    setDirectionalY,
    resetLighting,
    dispose() {
      ambientLight.removeFromParent();
      keyLight.removeFromParent();
      keyLight.dispose();
    },
  };
}
