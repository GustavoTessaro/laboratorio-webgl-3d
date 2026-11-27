import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEntityRegistry } from '../src/scene.js';
import { createGeometry, describeGeometry, geometries, GEOMETRY_BUDGET } from '../src/graphics/geometries.js';

const expected = {
  box: 'BoxGeometry', sphere: 'SphereGeometry', pyramid: 'ConeGeometry', torus: 'TorusGeometry',
  cylinder: 'CylinderGeometry', cone: 'ConeGeometry', plane: 'PlaneGeometry', capsule: 'CapsuleGeometry',
  tetrahedron: 'TetrahedronGeometry', octahedron: 'OctahedronGeometry', dodecahedron: 'DodecahedronGeometry',
  icosahedron: 'IcosahedronGeometry', torusKnot: 'TorusKnotGeometry',
};

test('all thirteen shapes fit their declared bounds and budget at default and maximum resolution', () => {
  assert.deepEqual(Object.keys(geometries).filter((type) => !geometries[type].modeling), Object.keys(expected));
  for (const type of Object.keys(expected)) {
    const { parameters } = geometries[type];
    const maximum = Object.fromEntries(Object.entries(parameters).map(([key, [, , max]]) => [key, max]));
    for (const supplied of [null, maximum]) {
      const spec = describeGeometry(type, supplied);
      const geometry = createGeometry(spec);
      assert.equal(geometry.type, expected[type]);
      assert.equal(geometry.parameters.radialSegments === 4, type === 'pyramid');
      geometry.computeBoundingBox();
      const limit = spec.halfSize.clone().addScalar(1e-6);
      assert.ok(new THREE.Box3(limit.clone().negate(), limit).containsBox(geometry.boundingBox), type);
      const vertices = geometry.getAttribute('position').count;
      assert.ok(vertices <= GEOMETRY_BUDGET.vertices, type);
      assert.ok((geometry.index?.count ?? vertices) / 3 <= GEOMETRY_BUDGET.triangles, type);
      geometry.dispose();
    }
  }
});

test('invalid or inapplicable parameters are rejected before allocating a mesh', () => {
  for (const [type, parameters] of [
    ['toString', null], ['box', { width: NaN }], ['box', { height: '2' }], ['box', { depth: null }],
    ['sphere', { widthSegments: 64.5 }], ['sphere', { heightSegments: 49 }],
    ['pyramid', { radialSegments: 8 }], ['torusKnot', { q: 9 }], ['dodecahedron', { detail: 8 }],
  ]) assert.throws(() => describeGeometry(type, parameters));
});

test('a parameter preview stays local, is reused on commit and preserves the animated object', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box', {
    x: 0, y: 3, z: 0, rotation: new THREE.Euler(0, 0, Math.PI / 4),
    color: '#123456', materialMode: 'wireframe', animation: { enabled: true, axis: 'y', speed: 50 },
  });
  const before = registry.serializeEntity(entity.id);
  assert.deepEqual(registry.getSharedEntities(), [before]);
  let disposed = 0;
  entity.mesh.geometry.addEventListener('dispose', () => { disposed += 1; });
  const published = [];
  registry.setMutationHandlers({ onChanged: (snapshot) => published.push(snapshot) });
  registry.updateAnimations(0.1);
  registry.setGeometry(entity, 'box', { width: 2, depthSegments: 3 }, true);
  const preview = entity.mesh.geometry;
  registry.updateAnimations(0.1);
  assert.deepEqual(registry.serializeEntity(entity.id), before);
  assert.deepEqual(published, []);
  assert.equal(disposed, 0);
  registry.setGeometry(entity, 'box', { width: 2, depthSegments: 3 });
  assert.equal(entity.mesh.geometry, preview);
  assert.equal(disposed, 1);
  const committed = { ...before, geometryParameters: { width: 2, depthSegments: 3 } };
  assert.deepEqual(published, [committed]);
  assert.equal(registry.setGeometry(entity, 'box', { depthSegments: 3, width: 2 }), false);
  assert.deepEqual(published, [committed]);

  const duplicate = registry.duplicateEntity(entity.id);
  assert.deepEqual(registry.serializeEntity(duplicate.id).geometryParameters, committed.geometryParameters);
  assert.equal(registry.getSharedEntities().length, 2);
  const peer = createEntityRegistry(new THREE.Scene());
  const legacy = { ...before };
  delete legacy.geometryParameters;
  peer.replaceEntities([legacy]);
  assert.deepEqual(peer.getSharedEntities(), [before]);
  const hydrated = peer.applyEntitySnapshot(committed);
  assert.deepEqual(peer.serializeEntity(entity.id), committed);
  const remoteGeometry = hydrated.mesh.geometry;
  peer.applyEntitySnapshot(committed);
  assert.equal(hydrated.mesh.geometry, remoteGeometry);
  registry.setGeometry(entity, 'box', null);
  assert.equal(registry.serializeEntity(entity.id).geometryParameters, null);
  registry.replaceGeometry(entity, 'capsule');
  assert.equal(entity.mesh.geometry.type, 'CapsuleGeometry');
  assert.deepEqual(registry.serializeEntity(entity.id).scale, before.scale);
});

test('geometry changes fit the floor without rescaling and reject overly large rotated forms', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box', {
    x: 9, y: 0.75, z: 0, rotation: new THREE.Euler(0, 0, Math.PI / 2),
    scale: new THREE.Vector3(1.5, 1, 1),
  });
  registry.setGeometry(entity, 'box', { width: 4, height: 4 });
  const accepted = registry.serializeEntity(entity.id);
  assert.ok(Math.abs(accepted.position.y - 3) < 1e-6);
  assert.ok(Math.abs(accepted.position.x - 8) < 1e-6);
  assert.deepEqual(accepted.scale, { x: 1.5, y: 1, z: 1 });
  assert.throws(() => registry.setGeometry(entity, 'box', { width: 8 }), /não cabe/);
  assert.deepEqual(registry.serializeEntity(entity.id), accepted);
  const original = entity.mesh.geometry;
  registry.setGeometry(entity, 'box', { width: 3 }, true);
  const preview = entity.mesh.geometry;
  let discarded = false;
  preview.addEventListener('dispose', () => { discarded = true; });
  registry.cancelGeometryPreview(entity);
  assert.equal(discarded, true);
  assert.equal(entity.mesh.geometry, original);
});
