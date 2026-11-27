import * as THREE from 'three';
import { sampleIndices } from './inspection-data.js';

export const INSPECTION_OVERLAYS = ['vertices', 'normals', 'edges', 'box', 'sphere'];
const NORMAL_LENGTH = 0.23;

function makeVertices(position) {
  const indices = sampleIndices(position.count);
  const data = new Float32Array(indices.length * 3);
  for (let i = 0; i < indices.length; i += 1) {
    const vertex = indices[i];
    data[i * 3] = position.getX(vertex);
    data[i * 3 + 1] = position.getY(vertex);
    data[i * 3 + 2] = position.getZ(vertex);
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.BufferAttribute(data, 3));
  return new THREE.Points(geometry, new THREE.PointsMaterial({ size: 4, sizeAttenuation: false, color: '#ffd479' }));
}

function makeSphere(sphere) {
  const segments = 32;
  const data = [];
  const { center, radius } = sphere;
  for (let plane = 0; plane < 3; plane += 1) {
    for (let i = 0; i < segments; i += 1) {
      for (let edge = 0; edge < 2; edge += 1) {
        const angle = (i + edge) / segments * Math.PI * 2;
        const a = Math.cos(angle) * radius;
        const b = Math.sin(angle) * radius;
        data.push(center.x + (plane === 0 ? 0 : a), center.y + (plane === 1 ? 0 : plane === 0 ? a : b),
          center.z + (plane === 2 ? 0 : b));
      }
    }
  }
  const geometry = new THREE.BufferGeometry().setAttribute('position', new THREE.Float32BufferAttribute(data, 3));
  return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ color: '#f396eb' }));
}

export function createInspectionHelpers(scene) {
  const group = new THREE.Group();
  group.name = 'Inspetor · limites e topologia';
  group.matrixAutoUpdate = false;
  group.visible = false;
  scene.add(group);

  const enabled = new Set();
  const overlays = new Map();
  const normalMatrix = new THREE.Matrix3();
  const normalWorld = new THREE.Matrix4();
  const start = new THREE.Vector3();
  const end = new THREE.Vector3();
  let normalSamples;
  let normalsNeedUpdate = true;
  let geometry;
  let open = false;

  function clear() {
    for (const overlay of overlays.values()) {
      if (!overlay) continue;
      overlay.removeFromParent();
      overlay.geometry.dispose();
      overlay.material.dispose();
    }
    overlays.clear();
    normalSamples = undefined;
    normalsNeedUpdate = true;
  }

  function makeOverlay(key) {
    const position = geometry.getAttribute('position');
    if (!position?.count) return null;
    switch (key) {
      case 'vertices': return makeVertices(position);
      case 'normals': {
        const normals = geometry.getAttribute('normal');
        if (!normals?.count) return null;
        normalSamples = sampleIndices(Math.min(position.count, normals.count));
        const attribute = new THREE.BufferAttribute(new Float32Array(normalSamples.length * 6), 3)
          .setUsage(THREE.DynamicDrawUsage);
        const lines = new THREE.LineSegments(
          new THREE.BufferGeometry().setAttribute('position', attribute),
          new THREE.LineBasicMaterial({ color: '#87eeab' }),
        );
        lines.frustumCulled = false;
        return lines;
      }
      case 'edges':
        return new THREE.LineSegments(new THREE.WireframeGeometry(geometry),
          new THREE.LineBasicMaterial({ color: '#8ac3ff', transparent: true, opacity: 0.65 }));
      case 'box':
        if (!geometry.boundingBox) geometry.computeBoundingBox();
        return new THREE.Box3Helper(geometry.boundingBox, '#f8b974');
      case 'sphere':
        if (!geometry.boundingSphere) geometry.computeBoundingSphere();
        return makeSphere(geometry.boundingSphere);
    }
  }

  function updateNormals(mesh, lines) {
    const position = geometry.getAttribute('position');
    const normal = geometry.getAttribute('normal');
    const attribute = lines.geometry.getAttribute('position');
    normalMatrix.getNormalMatrix(mesh.matrixWorld);
    for (let i = 0; i < normalSamples.length; i += 1) {
      const index = normalSamples[i];
      start.fromBufferAttribute(position, index).applyMatrix4(mesh.matrixWorld);
      end.fromBufferAttribute(normal, index).applyNormalMatrix(normalMatrix)
        .multiplyScalar(NORMAL_LENGTH).add(start);
      attribute.setXYZ(i * 2, start.x, start.y, start.z);
      attribute.setXYZ(i * 2 + 1, end.x, end.y, end.z);
    }
    attribute.needsUpdate = true;
    normalWorld.copy(mesh.matrixWorld);
    normalsNeedUpdate = false;
  }

  return {
    setOpen(value) {
      open = value;
      if (!open) {
        group.visible = false;
        const lines = overlays.get('normals');
        if (lines) lines.visible = false;
      }
    },
    setEnabled(key, value) {
      if (!INSPECTION_OVERLAYS.includes(key)) return;
      if (value) enabled.add(key);
      else enabled.delete(key);
    },
    update(mesh) {
      if (mesh?.geometry !== geometry) {
        clear();
        geometry = mesh?.geometry;
      }
      group.visible = Boolean(open && geometry && enabled.size);
      if (!group.visible) {
        const normals = overlays.get('normals');
        if (normals) normals.visible = false;
        return;
      }
      mesh.updateWorldMatrix(true, false);
      if (!group.matrix.equals(mesh.matrixWorld)) {
        group.matrix.copy(mesh.matrixWorld);
        group.matrixWorldNeedsUpdate = true;
      }
      for (const key of INSPECTION_OVERLAYS) {
        let overlay = overlays.get(key);
        const show = enabled.has(key);
        if (show && !overlays.has(key)) {
          overlay = makeOverlay(key);
          overlays.set(key, overlay);
          if (overlay) {
            overlay.name = `Inspetor · ${key}`;
            overlay.material.depthTest = false;
            overlay.material.depthWrite = false;
            overlay.renderOrder = 3;
            (key === 'normals' ? scene : group).add(overlay);
          }
        }
        if (overlay) {
          overlay.visible = show;
          if (show && key === 'normals' && (normalsNeedUpdate || !normalWorld.equals(mesh.matrixWorld))) {
            updateNormals(mesh, overlay);
          }
        }
      }
    },
    dispose() {
      clear();
      group.removeFromParent();
    },
  };
}
