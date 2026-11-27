import * as THREE from 'three';

export function createCoordinateHelpers(scene) {
  const world = new THREE.AxesHelper(2);
  const local = new THREE.AxesHelper(1.35);
  let showLocal = false;
  for (const helper of [world, local]) {
    helper.setColors('#ff4f55', '#54d477', '#598dff');
    helper.visible = false;
    helper.material.depthTest = false;
    helper.material.depthWrite = false;
    helper.renderOrder = 2;
    scene.add(helper);
  }

  return {
    setVisible(space, visible) {
      if (space === 'world') world.visible = Boolean(visible);
      if (space === 'local') showLocal = Boolean(visible);
    },
    update(mesh) {
      local.visible = showLocal && Boolean(mesh);
      if (local.visible) {
        mesh.getWorldPosition(local.position);
        mesh.getWorldQuaternion(local.quaternion);
      }
    },
    dispose() {
      for (const helper of [world, local]) {
        helper.removeFromParent();
        helper.dispose();
      }
    },
  };
}
