import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { createEntityRegistry } from '../src/graphics/entity-registry.js';
import { bindTransformEditing, synchronizeTransformTarget } from '../src/graphics/scene-controls.js';
import { createTrajectoryHelper } from '../src/graphics/trajectory-helper.js';
import { normalizeTrajectory, trajectoryFits } from '../src/graphics/trajectory-settings.js';
import { advanceTrajectory, createTrajectoryCurve, createTrajectoryMotion, trajectoryProgress } from '../src/graphics/trajectory-motion.js';

const vector = (x, y, z) => new THREE.Vector3(x, y, z);
const close = (actual, expected) => assert.ok(actual.distanceTo(expected) < 1e-6);

test('five curve types have expected start, mid and end points with native spline curves', () => {
  const examples = [
    ['circle', vector(1, 0, 0), vector(-1, 0, 0), vector(1, 0, 0)],
    ['ellipse', vector(1, 0, 0), vector(-1, 0, 0), vector(1, 0, 0)],
    ['helix', vector(1, 0, 0), vector(1, 1, 0), vector(1, 2, 0)],
    ['bezier', vector(-1, 0, 0), vector(0, 0.375, 0), vector(1, 0, 0)],
    ['catmull', vector(-1, 0, 0), vector(0, 0.5625, 0), vector(1, 0, 0)],
  ];
  for (const [type, start, middle, end] of examples) {
    const curve = createTrajectoryCurve(normalizeTrajectory({ type }));
    close(curve.getPoint(0), start);
    close(curve.getPoint(0.5), middle);
    close(curve.getPoint(1), end);
    assert.ok(curve.getLength() > 0);
  }
  const ellipse = createTrajectoryCurve(normalizeTrajectory({ type: 'ellipse', radius: 4, radiusB: 0.2, plane: 'yz' }));
  assert.ok(ellipse.getPointAt(0.125).distanceTo(ellipse.getPoint(0.125)) > 0.5);
  for (const i of [1, 40, 50, 75]) {
    const chord = ellipse.getPointAt(i / 100).distanceTo(ellipse.getPointAt((i + 1) / 100));
    assert.ok(Math.abs(chord * 100 / ellipse.getLength() - 1) < 0.03);
  }
});

test('duration, direction and transport modes advance in bounded local time', () => {
  for (const [mode, expected] of [['once', 0], ['loop', 0.75], ['pingpong', 0.25]]) {
    const motion = createTrajectoryMotion(normalizeTrajectory({ mode, reverse: true, duration: 2 }));
    advanceTrajectory(motion, 2.5);
    assert.deepEqual(trajectoryProgress(motion), { u: expected, backwards: mode !== 'pingpong' });
    motion.paused = true;
    const time = motion.elapsed;
    advanceTrajectory(motion, 0.2);
    assert.equal(motion.elapsed, time);
    motion.elapsed = 0;
    assert.equal(trajectoryProgress(motion).u, 1);
  }
});

test('validation catches bad descriptors, spline overshoot and rotation-dependent extents', () => {
  const p = (x) => ({ x, y: 0, z: 0 });
  assert.throws(() => normalizeTrajectory({ duration: 0 }));
  assert.throws(() => normalizeTrajectory({ type: 'bezier', points: [p(0), p(1)] }));
  assert.throws(() => normalizeTrajectory({ type: 'catmull', points: [p(0), p(0)] }), /distintas/);
  const line = createTrajectoryCurve(normalizeTrajectory({ type: 'catmull', points: [p(0), p(1)] }));
  close(line.getPoint(0.25), vector(0.25, 0, 0));
  const curve = normalizeTrajectory({ enabled: true, type: 'catmull', points: [p(-7), p(7), p(7), p(-7)] });
  assert.equal(trajectoryFits(curve, vector(2, 3, 0), vector(0.5, 0.5, 0.5)), false);
  const circle = normalizeTrajectory({ enabled: true });
  assert.equal(trajectoryFits(circle, vector(0, 0.75, 0), vector(0.7, 0.7, 0.7)), true);
  assert.equal(trajectoryFits(circle, vector(0, 0.75, 0), vector(0.7, 0.7, 0.7), 1.21), false);
  const helix = normalizeTrajectory({ type: 'helix', enabled: true, plane: 'yz', height: -8 });
  assert.equal(trajectoryFits(helix, vector(-2, 3, 0), vector(0.5, 0.5, 0.5)), false);
});

test('only confirmed descriptors publish and poses stay out of appearance, hydration and duplication', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const entity = registry.createEntity('box', { x: 0, y: 3, z: 0 });
  const publications = [];
  registry.setMutationHandlers({ onChanged: (snapshot) => publications.push(snapshot) });
  const base = registry.serializeEntity(entity.id).position;
  registry.setTrajectory(entity, { enabled: true, radius: 1.5 }, true);
  registry.updateAnimations(0.2);
  assert.equal(publications.length, 0);
  assert.equal(registry.serializeEntity(entity.id).trajectory, null);
  registry.setTrajectory(entity, { enabled: true, radius: 1.5 });
  registry.setTrajectory(entity, { enabled: true, radius: 1.5 });
  for (let i = 0; i < 100; ++i) registry.updateAnimations(0.05);
  assert.equal(publications.length, 1);
  assert.notDeepEqual(entity.mesh.position.toArray(), Object.values(base));
  registry.setAppearance(entity, '#123456');
  assert.deepEqual(publications.at(-1).position, base);
  const duplicate = registry.duplicateEntity(entity.id);
  assert.deepEqual(duplicate.trajectory, entity.trajectory);
  registry.copyEntityProperties(entity.id);
  const other = registry.createEntity('sphere', { x: 1, y: 4, z: 0 });
  assert.ok(registry.applyCopiedProperties(other.id));
  assert.deepEqual(other.trajectory, entity.trajectory);
  const boundary = registry.createEntity('box', { x: 9, y: 4, z: 0 });
  const beforeCopy = registry.serializeEntity(boundary.id);
  assert.equal(registry.applyCopiedProperties(boundary.id), false);
  assert.deepEqual(registry.serializeEntity(boundary.id), beforeCopy);
  const snap = JSON.parse(JSON.stringify(registry.getSharedEntities()));
  registry.replaceEntities(snap);
  assert.deepEqual(registry.getSharedEntities(), snap);
  const restored = registry.getEntity(entity.id);
  assert.equal(restored.trajectoryMotion.elapsed, 0);
  registry.setTrajectory(restored, { ...restored.trajectory, enabled: false });
  close(restored.mesh.position, vector(0, 3, 0));
  registry.dispose();
});

test('tangential orientation aligns base forward, then adds local spin and rejects unsafe geometry', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box', { x: 7, y: 4, z: 0, rotation: new THREE.Euler(0.3, 0.7, 0.2) });
  registry.setTrajectory(entity, { enabled: true, orient: true });
  close(vector(0, 0, 1).applyQuaternion(entity.mesh.quaternion), vector(0, 0, 1));
  const aimed = entity.mesh.quaternion.clone();
  registry.setAnimation(entity, { enabled: true, axis: 'y', speed: 90 });
  registry.updateAnimations(0.2);
  assert.ok(entity.mesh.quaternion.angleTo(aimed) > 0.1);
  const before = registry.serializeEntity(entity.id);
  assert.throws(() => registry.setGeometry(entity, 'box', { width: 6 }), /limites/);
  assert.deepEqual(registry.serializeEntity(entity.id), before);
  registry.setTrajectory(entity, { ...entity.trajectory, enabled: false });
  close(entity.mesh.position, vector(7, 4, 0));
  assert.equal(entity.rotationPhase, 0);
  assert.equal(entity.animation.enabled, true);
  registry.dispose();
});

test('gizmo freezes phase and commits valid deltas against the base, rejecting invalid paths', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box', { x: 0, y: 4, z: 0 });
  registry.setTrajectory(entity, { enabled: true, radius: 3 });
  registry.updateAnimations(0.5);
  const gizmo = new TransformControls(new THREE.PerspectiveCamera());
  synchronizeTransformTarget(gizmo, entity, 'translate');
  const edits = [];
  let rejected = 0;
  const editing = bindTransformEditing(gizmo, registry, {
    onEnd: (_, snapshot) => edits.push(snapshot),
    onRejected: () => rejected++,
  });
  for (const offset of [1, 7]) {
    gizmo.axis = 'X';
    gizmo.dragging = true;
    registry.updateAnimations(0.5);
    assert.equal(entity.trajectoryMotion.elapsed, 0.5);
    entity.mesh.position.x += offset;
    gizmo.dispatchEvent({ type: 'objectChange' });
    gizmo.dragging = false;
  }
  assert.equal(edits[0].position.x, 1);
  assert.equal(edits[0].trajectory.enabled, true);
  assert.equal(edits[1], null);
  assert.equal(rejected, 1);
  assert.equal(registry.serializeEntity(entity.id).position.x, 1);
  editing.dispose();
  registry.dispose();
});

test('local helper reuses buffers and disposes replacements and final resources', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const entity = registry.createEntity('box', { x: 0, y: 3, z: 0 });
  const overlay = createTrajectoryHelper(scene, registry.readBaseTransform);
  const group = scene.children.at(-1);
  overlay.setVisible(true);
  registry.setTrajectory(entity, { enabled: true });
  overlay.update(entity);
  const old = group.children[0].geometry;
  let releases = 0;
  old.addEventListener('dispose', () => releases++);
  registry.updateAnimations(1);
  overlay.update(entity);
  assert.equal(group.children[0].geometry, old);
  close(group.position, vector(0, 3, 0));
  registry.setTrajectory(entity, { enabled: true, type: 'bezier' });
  overlay.update(entity);
  assert.equal(releases, 1);
  assert.equal(group.children[1].geometry.attributes.position.count, 4);
  const material = group.children[0].material;
  material.addEventListener('dispose', () => releases++);
  overlay.dispose();
  assert.equal(releases, 2);
  assert.equal(group.parent, null);
  registry.dispose();
});
