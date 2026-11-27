import * as THREE from 'three';
import { trajectoryProgress } from './trajectory-motion.js';

export function createTrajectoryHelper(scene, readBaseTransform) {
  const group = new THREE.Group();
  const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0xfbbf24 }));
  const direction = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: 0x6ee7b7 }));
  const controls = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xfbbf24, size: 7, sizeAttenuation: false }));
  const endpoints = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ vertexColors: true, size: 11, sizeAttenuation: false }));
  group.add(line, controls, endpoints, direction);
  group.visible = false;
  group.traverse((helper) => { helper.raycast = () => {}; });
  scene.add(group);
  let enabled = false;
  let motion;
  const base = { position: new THREE.Vector3(), rotation: new THREE.Euler(), scale: new THREE.Vector3() };

  function replacePoints(object, points) {
    object.geometry.dispose();
    object.geometry = new THREE.BufferGeometry().setFromPoints(points);
  }

  return {
    setVisible(value) { enabled = value; if (!value) group.visible = false; },
    update(entity) {
      const next = entity?.trajectoryPreview === undefined ? entity?.trajectoryMotion : entity.trajectoryPreview;
      group.visible = Boolean(enabled && next);
      if (motion && motion !== next && !group.visible) {
        motion = null;
        for (const child of group.children) replacePoints(child, []);
      }
      if (!group.visible) return;
      if (motion !== next) {
        motion = next;
        replacePoints(line, motion.curve.getPoints(128));
        replacePoints(controls, (motion.settings.points ?? []).map(({ x, y, z }) => new THREE.Vector3(x, y, z)));
        controls.visible = Boolean(motion.settings.points);
        const { u } = trajectoryProgress({ settings: motion.settings, elapsed: 0 });
        const start = motion.curve.getPoint(u);
        const end = motion.curve.getPoint(1 - u);
        const closed = start.distanceToSquared(end) < 1e-10;
        replacePoints(endpoints, closed ? [start] : [start, end]);
        endpoints.geometry.setAttribute('color', new THREE.Float32BufferAttribute(
          closed ? [0.1, 1, 0.45] : [0.1, 1, 0.45, 1, 0.25, 0.15], 3,
        ));
        const tip = motion.curve.getPointAt(u ? 0.9 : 0.1);
        const tail = motion.curve.getPointAt(u ? 0.92 : 0.08);
        const along = tip.clone().sub(tail).normalize();
        const side = new THREE.Vector3(0, Math.abs(along.y) < 0.9 ? 1 : 0, Math.abs(along.y) < 0.9 ? 0 : 1)
          .cross(along).normalize();
        const elbow = tip.clone().addScaledVector(along, -0.18);
        replacePoints(direction, [
          elbow.clone().addScaledVector(side, 0.1), tip, elbow.addScaledVector(side, -0.1),
        ]);
      }
      if (readBaseTransform(entity.id, base)) group.position.copy(base.position);
    },
    dispose() {
      group.removeFromParent();
      for (const object of group.children) {
        object.geometry.dispose();
        object.material.dispose();
      }
    },
  };
}
