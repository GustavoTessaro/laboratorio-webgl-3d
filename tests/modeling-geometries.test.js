import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEntityRegistry } from '../src/scene.js';
import { createGeometry, describeGeometry, geometries } from '../src/graphics/geometries.js';
import { encodeModelingPoints } from '../src/graphics/modeling-geometries.js';

const withPoints = (type, points, options) => describeGeometry(type, { ...encodeModelingPoints(points), ...options });

function checkBounds(spec, geometry) {
  geometry.computeBoundingBox();
  const limit = spec.halfSize.clone().addScalar(1e-6);
  assert.ok(new THREE.Box3(limit.clone().negate(), limit).containsBox(geometry.boundingBox));
  assert.ok(geometry.getAttribute('normal').array.every(Number.isFinite));
  assert.ok(geometry.getAttribute('uv').array.every(Number.isFinite));
}

test('all editable presets generate native lathe and extrude meshes within conservative bounds', () => {
  for (const type of ['lathe', 'extrude']) {
    const { presets } = geometries[type].modeling;
    for (const preset of Object.values(presets)) {
      const spec = withPoints(type, preset.points, preset.rounded ? { rounded: 1 } : {});
      const geometry = createGeometry(spec);
      assert.equal(geometry.type, type === 'lathe' ? 'LatheGeometry' : 'ExtrudeGeometry');
      assert.equal(Boolean(geometry.index), type === 'lathe');
      checkBounds(spec, geometry);
      geometry.dispose();
    }
  }
});

test('the lathe follows its Y-axis convention and partial angles keep the axis fixed', () => {
  const points = [[1, -1], [1, 1]];
  const partial = withPoints('lathe', points, { startAngle: 90, sweepAngle: 90, radialSegments: 8 });
  const geometry = createGeometry(partial);
  const position = geometry.getAttribute('position');
  assert.ok(Math.abs(position.getX(0) - 1) < 1e-6);
  assert.ok(Math.abs(position.getZ(0)) < 1e-6);
  assert.equal(position.getY(0), -1);
  geometry.computeBoundingBox();
  assert.ok(geometry.boundingBox.min.x >= -1e-6);
  assert.ok(geometry.boundingBox.max.z <= 1e-6);
  const full = createGeometry(withPoints('lathe', points, { radialSegments: 8 }));
  checkBounds(partial, full);
  assert.ok(full.boundingBox.min.x < -0.99);
  geometry.dispose();
  full.dispose();
});

test('extrusion depth, curve density and bevel change mesh counts and preserve declared bounds', () => {
  const flat = createGeometry(describeGeometry('extrude'));
  const spec = describeGeometry('extrude', { bevelEnabled: 1, depth: 1, depthSegments: 3 });
  const bevel = createGeometry(spec);
  checkBounds(spec, bevel);
  assert.ok(Math.abs(bevel.boundingBox.max.z - 0.58) < 1e-6);
  assert.equal(bevel.getAttribute('position').count, 180);
  assert.equal(flat.getAttribute('position').count, 36);
  assert.equal(flat.groups.length, 2);
  const heart = geometries.extrude.modeling.presets.heart.points;
  const midpoint = createGeometry(withPoints('extrude', heart, { rounded: 1, curveSegments: 3 }));
  const smooth = createGeometry(withPoints('extrude', heart, { rounded: 1, curveSegments: 9 }));
  assert.ok(smooth.getAttribute('position').count > midpoint.getAttribute('position').count);
  for (const geometry of [flat, bevel, midpoint, smooth]) geometry.dispose();
});

test('invalid profiles, contours, bevels and descriptors are rejected before constructing buffers', () => {
  const rectangle = [[-1, -1], [1, -1], [1, 1], [-1, 1]];
  const gear = geometries.extrude.modeling.presets.gear.points;
  for (const [type, points, parameters] of [
    ['lathe', [[-1, 0], [1, 1]]], ['lathe', [[0.4, 1], [0.4, 0]]],
    ['lathe', [[0, 0], [0, 1]]], ['lathe', [[1, 0], [0, 1], [1, 2]]],
    ['lathe', [[1, 0], [1, 1]], { radialSegments: 129 }],
    ['extrude', [[0, 0], [1, 1], [0, 1], [1, 0]]],
    ['extrude', [[0, 0], [1, 0], [0.01, 0.0001]]],
    ['extrude', [[0, 0], [1, 0], [1, 1], [1, 0]]],
    ['extrude', rectangle, { depth: 0 }], ['extrude', gear, { bevelEnabled: 1, bevelSize: 0.4 }],
    ['extrude', gear, { rounded: 1, curveSegments: 12, depthSegments: 32 }],
    ['extrude', [...gear, [0, 0]]],
  ]) assert.throws(() => withPoints(type, points, parameters));
  assert.throws(() => describeGeometry('lathe', { pointCount: 2, x0: 200, y0: 10, x1: 20 }));
  assert.throws(() => describeGeometry('extrude', { x0: 100 }));
  assert.throws(() => withPoints('extrude', rectangle, { x4: 100 }));
  assert.throws(() => withPoints('extrude', rectangle, { x1: 1.01 }));
});

test('maximum profiles and deep polygonal extrusion stay in budget, with bounded JSON descriptors', () => {
  const profile = Array.from({ length: 24 }, (_, i) => [0.5, -3 + i * 0.2]);
  const lathe = createGeometry(withPoints('lathe', profile, { radialSegments: 128 }));
  assert.equal(lathe.getAttribute('position').count, 3096);
  assert.equal(lathe.index.count / 3, 5888);
  const gear = geometries.extrude.modeling.presets.gear.points;
  const spec = withPoints('extrude', gear, { depthSegments: 32, bevelEnabled: 1, bevelSize: 0.005, bevelSegments: 6 });
  const extrude = createGeometry(spec);
  assert.equal(extrude.getAttribute('position').count, 6468);
  assert.ok(JSON.stringify(spec.overrides).length < 1024);
  checkBounds(spec, extrude);
  lathe.dispose();
  extrude.dispose();
});

test('custom shape preview commits once, keeps authored properties and hydrates without mesh payloads', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('lathe', { x: 0, y: 4, z: 0 });
  registry.setAppearance(entity, '#123456', 'wireframe', { textureId: 'wood', opacity: 0.5, transparent: true });
  registry.setAnimation(entity, { enabled: true });
  registry.setTrajectory(entity, { enabled: true });
  const before = registry.serializeEntity(entity.id);
  let disposed = 0;
  entity.mesh.geometry.addEventListener('dispose', () => disposed++);
  const confirmed = [];
  registry.setMutationHandlers({ onChanged: (snapshot) => confirmed.push(snapshot) });
  const points = geometries.lathe.modeling.presets.bottle.points.map((p, i) => i === 2 ? [0.62, p[1]] : p);
  const edit = { ...encodeModelingPoints(points), sweepAngle: 180 };
  registry.setGeometry(entity, 'lathe', edit, true);
  const preview = entity.mesh.geometry;
  registry.updateAnimations(0.05);
  assert.equal(confirmed.length, 0);
  assert.equal(disposed, 0);
  registry.setGeometry(entity, 'lathe', edit);
  assert.equal(preview, entity.mesh.geometry);
  assert.equal(disposed, 1);
  registry.setGeometry(entity, 'lathe', edit);
  assert.equal(confirmed.length, 1);
  assert.deepEqual(confirmed[0], { ...before, geometryParameters: edit });
  assert.throws(() => registry.setGeometry(entity, 'lathe', encodeModelingPoints([[4, -4], [4, 4]])), /limites/);
  const duplicate = registry.duplicateEntity(entity.id);
  assert.deepEqual(duplicate.geometrySpec.model.points, points);
  registry.copyEntityProperties(duplicate.id);
  const receiver = registry.createEntity('extrude', { x: 0, y: 4, z: 0 });
  assert.equal(registry.applyCopiedProperties(receiver.id), true);
  assert.equal(receiver.type, 'extrude');
  assert.equal(receiver.color, '#123456');
  assert.deepEqual(receiver.trajectory, entity.trajectory);
  const snapshots = JSON.parse(JSON.stringify(registry.getSharedEntities()));
  registry.replaceEntities(snapshots);
  assert.deepEqual(registry.getSharedEntities(), snapshots);
  registry.dispose();
});
