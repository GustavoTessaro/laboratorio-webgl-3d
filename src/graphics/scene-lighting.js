import * as THREE from 'three';
import { WORKSPACE_SIZE } from './scene-assets.js';
import { DEFAULT_LIGHTING } from './lighting-settings.js';

const sizes = {
  low: { directional: 512, spot: 512, point: 128 },
  medium: { directional: 1024, spot: 1024, point: 256 },
  high: { directional: 2048, spot: 1024, point: 256 },
};
const lightHelperFactories = {
  hemisphere: (light) => new THREE.HemisphereLightHelper(light, 0.6),
  directional: (light) => new THREE.DirectionalLightHelper(light, 0.8),
  point: (light) => new THREE.PointLightHelper(light, 0.3),
  spot: (light) => new THREE.SpotLightHelper(light),
};

export function createSceneLighting(scene, maxTextureSize = 4096) {
  const lights = {
    ambient: new THREE.AmbientLight(),
    hemisphere: new THREE.HemisphereLight(),
    directional: new THREE.DirectionalLight(),
    point: new THREE.PointLight(),
    spot: new THREE.SpotLight(),
  };
  scene.add(...Object.values(lights), lights.directional.target, lights.spot.target);

  const grid = new THREE.GridHelper(WORKSPACE_SIZE, 40, '#68748a', '#343d4d');
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(WORKSPACE_SIZE, WORKSPACE_SIZE),
    new THREE.MeshStandardMaterial({ roughness: 0.9, metalness: 0 }));
  floor.position.y = -0.015;
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor, grid);

  const helpers = new Map();
  const shadowHelpers = new Map();
  for (const [name, light] of Object.entries(lights)) {
    if (!light.shadow) continue;
    light.shadow.bias = name === 'point' ? -0.0002 : -0.0004;
    light.shadow.normalBias = name === 'directional' ? 0.035 : 0.025;
    light.shadow.camera.near = 0.1;
    light.shadow.camera.far = name === 'directional' ? 70 : 45;
  }
  const camera = lights.directional.shadow.camera;
  camera.left = camera.bottom = -17;
  camera.right = camera.top = 17;
  camera.updateProjectionMatrix();

  function updateHelpers() {
    for (const [group, helper] of helpers) {
      helper.visible = lights[group].visible && helper.userData.enabled;
      if (helper.visible) helper.update();
    }
    for (const [group, helper] of shadowHelpers) {
      const light = lights[group];
      helper.visible = light.visible && light.castShadow && helper.userData.enabled;
      if (helper.visible) {
        light.shadow.updateMatrices(light);
        helper.update();
      }
    }
  }

  function apply(settings) {
    const quality = sizes[settings.environment.shadowQuality];
    for (const [group, light] of Object.entries(lights)) {
      const config = settings[group];
      light.visible = config.enabled;
      light.color.set(config.color);
      light.intensity = config.intensity;
      if (light.groundColor) light.groundColor.set(config.groundColor);
      if ('x' in config) light.position.set(config.x, config.y, config.z);
      if (light.target) {
        light.target.position.set(config.targetX, config.targetY, config.targetZ);
        light.target.updateMatrixWorld();
      }
      if ('distance' in config) {
        light.distance = config.distance;
        light.decay = config.decay;
        const shadowCamera = light.shadow.camera;
        const far = config.distance || 45;
        if (shadowCamera.far !== far) {
          shadowCamera.far = far;
          shadowCamera.updateProjectionMatrix();
        }
      }
      if (light.isSpotLight) {
        light.angle = THREE.MathUtils.degToRad(config.angle);
        light.penumbra = config.penumbra;
      }
      light.updateMatrixWorld();
      if (!light.shadow) continue;
      light.castShadow = config.enabled && config.castShadow;
      const size = Math.min(quality[group], Math.floor(maxTextureSize / (light.isPointLight ? 4 : 1)));
      if (light.shadow.mapSize.x !== size || !light.castShadow) {
        light.shadow.dispose();
        light.shadow.map = null;
        light.shadow.mapPass = null;
        light.shadow.mapSize.set(size, size);
      }
    }
    floor.visible = settings.environment.floorVisible;
    grid.visible = settings.environment.gridVisible;
    floor.material.color.set(settings.environment.floorColor);
    updateHelpers();
  }

  function setHelper(group, kind, enabled) {
    const isCamera = kind === 'shadow';
    if (isCamera ? !['directional', 'spot'].includes(group) : !Object.hasOwn(lightHelperFactories, group)) return;
    const collection = isCamera ? shadowHelpers : helpers;
    if (!collection.has(group) && enabled) {
      const light = lights[group];
      const helper = isCamera ? new THREE.CameraHelper(light.shadow.camera) : lightHelperFactories[group](light);
      scene.add(helper);
      collection.set(group, helper);
    }
    if (collection.has(group)) {
      collection.get(group).userData.enabled = enabled;
      updateHelpers();
    }
  }

  apply(DEFAULT_LIGHTING);
  return {
    apply,
    setHelper,
    dispose() {
      for (const helper of [...helpers.values(), ...shadowHelpers.values()]) {
        helper.removeFromParent();
        helper.dispose();
      }
      helpers.clear();
      shadowHelpers.clear();
      for (const light of Object.values(lights)) {
        light.target?.removeFromParent();
        light.removeFromParent();
        light.dispose();
      }
      grid.removeFromParent();
      grid.dispose();
      floor.removeFromParent();
      floor.geometry.dispose();
      floor.material.dispose();
    },
  };
}
