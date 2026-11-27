import * as THREE from 'three';
import { WORKSPACE_HEIGHT, WORKSPACE_LIMIT } from './scene-assets.js';

export const CAMERA_LIMITS = { fov: [25, 85], zoom: [0.25, 4] };
const DEFAULT_FOV = 50;
const DEFAULT_POSITION = new THREE.Vector3(4, 3, 5);
const DEFAULT_TARGET = new THREE.Vector3(0, 0.5, 0);
const NEAR = 0.1;
const FAR = 600;
const MIN_DISTANCE = 0.6;
const MAX_DISTANCE = 370;
const FRAME_MARGIN = 1.15;

export const CAMERA_VIEWS = {
  front: [0, 0, 1],
  back: [0, 0, -1],
  top: [0, 1, 0.00001],
  bottom: [0, -1, 0.00001],
  left: [-1, 0, 0],
  right: [1, 0, 0],
  isometric: [1, 1, 1],
};

export function createViewCamera() {
  const perspective = new THREE.PerspectiveCamera(DEFAULT_FOV, 1, NEAR, FAR);
  const orthographic = new THREE.OrthographicCamera(-1, 1, 1, -1, NEAR, FAR);
  perspective.position.copy(DEFAULT_POSITION);
  let active = perspective;
  let aspect = 1;
  let orthographicSpan = 6;
  let controls;
  let gizmo;
  let onChange = () => {};

  function updateFrustum() {
    const half = orthographicSpan / 2;
    orthographic.top = half;
    orthographic.bottom = -half;
    orthographic.left = -half * aspect;
    orthographic.right = half * aspect;
    orthographic.updateProjectionMatrix();
  }

  function updateView() {
    if (controls) controls.update();
    active.updateMatrixWorld();
    onChange(state());
  }

  function settleOrbit() {
    // OrbitControls applies its residual damping even after a programmatic move.
    const damping = controls.enableDamping;
    controls.enableDamping = false;
    controls.update();
    controls.enableDamping = damping;
  }

  function useCamera(camera) {
    active = camera;
    controls.object = active;
    gizmo.camera = active;
  }

  function direction() {
    return new THREE.Vector3().subVectors(active.position, controls.target).normalize();
  }

  function tanHalfFov() {
    return Math.tan(THREE.MathUtils.degToRad(perspective.fov / 2));
  }

  function state() {
    return {
      projection: active.isPerspectiveCamera ? 'perspective' : 'orthographic',
      fov: perspective.fov,
      zoom: orthographic.zoom,
      position: active.position.toArray(),
      target: controls?.target.toArray() ?? DEFAULT_TARGET.toArray(),
    };
  }

  function handleOrbitChange() { onChange(state()); }

  return {
    get camera() { return active; },
    state,
    connect(orbitControls, transformControls) {
      controls = orbitControls;
      gizmo = transformControls;
      controls.minDistance = MIN_DISTANCE;
      controls.maxDistance = MAX_DISTANCE;
      [controls.minZoom, controls.maxZoom] = CAMERA_LIMITS.zoom;
      controls.target.copy(DEFAULT_TARGET);
      controls.cursor.copy(DEFAULT_TARGET);
      controls.addEventListener('change', handleOrbitChange);
      updateFrustum();
      updateView();
    },
    setChangeHandler(handler = () => {}) {
      onChange = handler;
      onChange(state());
    },
    resize(width, height) {
      if (!(width > 0 && height > 0)) return;
      aspect = width / height;
      perspective.aspect = aspect;
      perspective.updateProjectionMatrix();
      updateFrustum();
    },
    setProjection(projection) {
      if (projection !== 'perspective' && projection !== 'orthographic') return;
      const next = projection === 'perspective' ? perspective : orthographic;
      if (active === next) return;
      settleOrbit();
      const offset = direction();
      const distance = active.position.distanceTo(controls.target);
      if (next === orthographic) {
        orthographicSpan = 2 * distance * tanHalfFov();
        orthographic.zoom = 1;
        updateFrustum();
        next.position.copy(active.position);
      } else {
        const framingDistance = orthographicSpan / (orthographic.zoom * 2 * tanHalfFov());
        next.position.copy(controls.target).addScaledVector(offset,
          THREE.MathUtils.clamp(framingDistance, MIN_DISTANCE, MAX_DISTANCE));
      }
      next.quaternion.copy(active.quaternion);
      useCamera(next);
      updateView();
    },
    setFov(value) {
      if (!Number.isFinite(value)) return;
      perspective.fov = THREE.MathUtils.clamp(value, ...CAMERA_LIMITS.fov);
      perspective.updateProjectionMatrix();
      updateView();
    },
    setZoom(value) {
      if (!Number.isFinite(value)) return;
      orthographic.zoom = THREE.MathUtils.clamp(value, ...CAMERA_LIMITS.zoom);
      updateFrustum();
      updateView();
    },
    setTarget(axis, value) {
      if (!['x', 'y', 'z'].includes(axis) || !Number.isFinite(value)) return;
      settleOrbit();
      const [min, max] = axis === 'y' ? [0, WORKSPACE_HEIGHT] : [-WORKSPACE_LIMIT, WORKSPACE_LIMIT];
      const next = THREE.MathUtils.clamp(value, min, max);
      active.position[axis] += next - controls.target[axis];
      controls.target[axis] = next;
      updateView();
    },
    preset(name) {
      if (!Object.hasOwn(CAMERA_VIEWS, name)) return;
      settleOrbit();
      const distance = active.position.distanceTo(controls.target);
      const offset = new THREE.Vector3(...CAMERA_VIEWS[name]).normalize();
      active.position.copy(controls.target).addScaledVector(offset, distance);
      updateView();
    },
    frame(meshes) {
      const bounds = new THREE.Box3();
      const box = new THREE.Box3();
      for (const mesh of meshes) {
        const wave = mesh.userData.shaderDisplacement;
        if (wave) {
          mesh.updateWorldMatrix(true, false);
          if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
          box.copy(mesh.geometry.boundingBox);
          box.min.y -= wave;
          box.max.y += wave;
          box.applyMatrix4(mesh.matrixWorld);
        } else box.setFromObject(mesh, true);
        bounds.union(box);
      }
      if (bounds.isEmpty()) return false;

      settleOrbit();
      const target = bounds.getCenter(new THREE.Vector3());
      const towardCamera = direction();
      const right = new THREE.Vector3(1, 0, 0).applyQuaternion(active.quaternion);
      const up = new THREE.Vector3(0, 1, 0).applyQuaternion(active.quaternion);
      const corner = new THREE.Vector3();
      let distance = MIN_DISTANCE;
      let halfSpan = 0.2;
      for (const x of [bounds.min.x, bounds.max.x]) {
        for (const y of [bounds.min.y, bounds.max.y]) {
          for (const z of [bounds.min.z, bounds.max.z]) {
            corner.set(x, y, z).sub(target);
            const depth = corner.dot(towardCamera);
            const height = FRAME_MARGIN * Math.max(Math.abs(corner.dot(right)) / aspect, Math.abs(corner.dot(up)));
            halfSpan = Math.max(halfSpan, height);
            distance = Math.max(distance, depth + NEAR + 0.15,
              active.isPerspectiveCamera ? depth + height / tanHalfFov() : 0);
          }
        }
      }
      if (active.isOrthographicCamera) {
        orthographicSpan = 2 * halfSpan;
        orthographic.zoom = 1;
        updateFrustum();
        distance = Math.max(distance, active.position.distanceTo(controls.target));
      }
      controls.target.copy(target);
      active.position.copy(target).addScaledVector(towardCamera, Math.min(distance, MAX_DISTANCE));
      updateView();
      return true;
    },
    reset() {
      settleOrbit();
      controls.target.copy(DEFAULT_TARGET);
      perspective.position.copy(DEFAULT_POSITION);
      perspective.fov = DEFAULT_FOV;
      perspective.updateProjectionMatrix();
      orthographicSpan = 6;
      orthographic.zoom = 1;
      updateFrustum();
      useCamera(perspective);
      updateView();
    },
    dispose() {
      controls?.removeEventListener('change', handleOrbitChange);
      onChange = () => {};
    },
  };
}
