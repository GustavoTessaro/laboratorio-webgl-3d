import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { CAMERA_LIMITS, CAMERA_VIEWS, createViewCamera } from '../src/graphics/view-camera.js';
import { createCoordinateHelpers } from '../src/graphics/coordinate-helpers.js';
import { createEntityRegistry } from '../src/scene.js';

function createRig() {
  const view = createViewCamera();
  const orbit = new OrbitControls(view.camera);
  const gizmo = new TransformControls(view.camera);
  view.connect(orbit, gizmo);
  return { view, orbit, gizmo };
}

function assertVector(actual, expected, tolerance = 1e-8) {
  assert.ok(actual.distanceTo(expected) < tolerance, `${actual.toArray()} != ${expected.toArray()}`);
}

test('changing projection retains target, direction and apparent scale at the target', () => {
  const { view, orbit, gizmo } = createRig();
  assert.equal(view.state().projection, 'perspective');
  view.resize(810, 620);
  view.setTarget('x', 2);
  const target = orbit.target.clone();
  const direction = view.camera.getWorldDirection(new THREE.Vector3());
  const worldUpOnScreen = new THREE.Vector3(0, 1, 0).applyQuaternion(view.camera.quaternion);
  const point = target.clone().add(worldUpOnScreen);
  const projected = point.clone().project(view.camera);
  const originalPosition = view.camera.position.clone();
  view.setProjection('orthographic');
  assert.equal(orbit.object, view.camera);
  assert.equal(gizmo.camera, view.camera);
  assertVector(view.camera.position, originalPosition);
  assertVector(orbit.target, target);
  assertVector(view.camera.getWorldDirection(new THREE.Vector3()), direction);
  assert.ok(Math.abs(point.clone().project(view.camera).y - projected.y) < 1e-8);

  view.setZoom(2);
  const zoomed = point.clone().project(view.camera).y;
  view.setProjection('perspective');
  assert.ok(Math.abs(point.clone().project(view.camera).y - zoomed) < 1e-8);
  assertVector(orbit.target, target);
  assertVector(view.camera.getWorldDirection(new THREE.Vector3()), direction);
  assert.equal(orbit.object, view.camera);
  assert.equal(gizmo.camera, view.camera);
});

test('the seven views respect the axis convention and allow center raycasting in both projections', () => {
  const { view, orbit } = createRig();
  const raycaster = new THREE.Raycaster();
  const object = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshBasicMaterial());
  object.position.copy(orbit.target);
  object.updateMatrixWorld();
  for (const projection of ['perspective', 'orthographic']) {
    view.setProjection(projection);
    for (const [name, axes] of Object.entries(CAMERA_VIEWS)) {
      view.preset(name);
      assertVector(view.camera.position.clone().sub(orbit.target).normalize(),
        new THREE.Vector3(...axes).normalize());
      raycaster.setFromCamera(new THREE.Vector2(0, 0), view.camera);
      assert.equal(raycaster.intersectObject(object)[0]?.object, object, name);
    }
  }
  object.geometry.dispose();
  object.material.dispose();
});

test('framing fits real dimensions, scaled rotations and distant objects in portrait', () => {
  const { view, orbit } = createRig();
  const registry = createEntityRegistry(new THREE.Scene());
  const large = registry.createEntity('box', {
    x: 7, y: 6, z: 1, geometryParameters: { width: 4, height: 2, depth: 3 },
    rotation: new THREE.Euler(0.4, 0.7, 0.1), scale: new THREE.Vector3(1.5, 1.2, 0.7),
  });
  const small = registry.createEntity('capsule', {
    x: -8, y: 1, z: -8, geometryParameters: { radius: 0.3, length: 0.7 },
  });
  const checker = (meshes) => {
    const bounds = new THREE.Box3();
    for (const mesh of meshes) bounds.union(new THREE.Box3().setFromObject(mesh, true));
    assertVector(orbit.target, bounds.getCenter(new THREE.Vector3()));
    for (const x of [bounds.min.x, bounds.max.x]) {
      for (const y of [bounds.min.y, bounds.max.y]) {
        for (const z of [bounds.min.z, bounds.max.z]) {
          const ndc = new THREE.Vector3(x, y, z).project(view.camera);
          assert.ok([ndc.x, ndc.y, ndc.z].every((value) => Math.abs(value) < 1), ndc.toArray().join(', '));
        }
      }
    }
  };
  view.resize(310, 650);
  view.setFov(25);
  for (const projection of ['perspective', 'orthographic']) {
    view.setProjection(projection);
    view.preset('isometric');
    assert.equal(view.frame([large.mesh]), true);
    checker([large.mesh]);
    assert.equal(view.frame([large.mesh, small.mesh]), true);
    checker([large.mesh, small.mesh]);
  }
  const previous = view.state();
  assert.equal(view.frame([]), false);
  assert.deepEqual(view.state(), previous);
  registry.dispose();
});

test('fov, zoom and target are bounded and resize updates the two frusta', () => {
  const { view, orbit } = createRig();
  view.setFov(1000);
  assert.equal(view.camera.fov, CAMERA_LIMITS.fov[1]);
  view.setFov(-1);
  assert.equal(view.camera.fov, CAMERA_LIMITS.fov[0]);
  view.setFov(NaN);
  assert.equal(view.camera.fov, CAMERA_LIMITS.fov[0]);
  view.resize(1200, 600);
  assert.equal(view.camera.aspect, 2);
  view.setProjection('orthographic');
  view.setZoom(0);
  assert.equal(view.camera.zoom, CAMERA_LIMITS.zoom[0]);
  view.setZoom(20);
  assert.equal(view.camera.zoom, CAMERA_LIMITS.zoom[1]);
  const vertical = view.camera.top;
  view.resize(420, 840);
  assert.equal(view.camera.top, vertical);
  assert.equal(view.camera.right, vertical / 2);
  view.resize(0, 1);
  assert.equal(view.camera.right, vertical / 2);
  view.setTarget('z', -50);
  view.setTarget('y', 20);
  assert.equal(orbit.target.z, -10);
  assert.ok(Math.abs(orbit.target.y - 10) < 1e-9);
  view.reset();
  assert.equal(view.state().projection, 'perspective');
  assert.equal(view.state().fov, 50);
  assert.equal(view.state().zoom, 1);
  assertVector(view.camera.position, new THREE.Vector3(4, 3, 5));
  assertVector(orbit.target, new THREE.Vector3(0, 0.5, 0));
});

test('coordinate helpers follow the visible pose without parenting to the selected mesh and dispose', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const entity = registry.createEntity();
  const helpers = createCoordinateHelpers(scene);
  const [world, local] = scene.children.filter((object) => object.type === 'AxesHelper');
  assert.equal(world.visible, false);
  helpers.setVisible('world', true);
  helpers.setVisible('local', true);
  entity.animation.enabled = true;
  registry.updateAnimations(0.2);
  helpers.update(entity.mesh);
  assert.equal(world.visible, true);
  assert.equal(local.visible, true);
  assert.equal(local.parent, scene);
  assertVector(local.position, entity.mesh.position);
  assert.ok(local.quaternion.angleTo(entity.mesh.quaternion) < 1e-6);
  helpers.update(null);
  assert.equal(local.visible, false);
  const disposed = [];
  for (const helper of [world, local]) {
    helper.geometry.addEventListener('dispose', () => disposed.push('geometry'));
    helper.material.addEventListener('dispose', () => disposed.push('material'));
  }
  helpers.dispose();
  assert.deepEqual(disposed, ['geometry', 'material', 'geometry', 'material']);
  assert.deepEqual(scene.children, [entity.mesh]);
  registry.dispose();
});
