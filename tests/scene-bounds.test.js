import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEntityRegistry } from '../src/scene.js';

function createRegistry() {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  return { scene, registry };
}

function getBounds(entity) {
  entity.mesh.updateWorldMatrix(true, false);
  return new THREE.Box3().setFromObject(entity.mesh);
}

function assertInsideWorkspace(entity) {
  const bounds = getBounds(entity);
  const epsilon = 1e-5;
  assert.ok(bounds.min.x >= -10 - epsilon);
  assert.ok(bounds.max.x <= 10 + epsilon);
  assert.ok(bounds.min.y >= -epsilon);
  assert.ok(bounds.max.y <= 10 + epsilon);
  assert.ok(bounds.min.z >= -10 - epsilon);
  assert.ok(bounds.max.z <= 10 + epsilon);
}

test('position corrections enforce the floor and ceiling', () => {
  const { registry } = createRegistry();
  const entity = registry.createEntity('box');

  entity.mesh.position.y = -20;
  registry.constrainEntity(entity);
  assertInsideWorkspace(entity);
  assert.ok(Math.abs(getBounds(entity).min.y) < 1e-5);

  entity.mesh.position.y = 20;
  registry.constrainEntity(entity);
  assertInsideWorkspace(entity);
  assert.ok(Math.abs(getBounds(entity).max.y - 10) < 1e-5);
});

test('scaled and rotated objects are corrected inside all horizontal boundaries', () => {
  const { registry } = createRegistry();
  const entity = registry.createEntity('box');
  entity.mesh.scale.set(3, 3, 3);
  entity.mesh.rotation.set(0.8, 0.65, 0.9);
  entity.mesh.position.set(50, 50, -50);

  registry.constrainEntityScale(entity);

  assertInsideWorkspace(entity);
  assert.ok(entity.mesh.scale.x <= 3);
  assert.ok(entity.mesh.scale.y <= 3);
  assert.ok(entity.mesh.scale.z <= 3);
});

test('automatic rotation near the ceiling remains within the workspace', () => {
  const { registry } = createRegistry();
  const entity = registry.createEntity('pyramid');
  entity.mesh.position.y = 50;
  entity.animation.enabled = true;
  entity.animation.axis = 'x';
  registry.constrainEntity(entity);
  registry.updateAnimations(1);

  assertInsideWorkspace(entity);
});

test('geometry replacement and copied scale keep the target inside the workspace', () => {
  const { registry } = createRegistry();
  const source = registry.createEntity('box');
  const target = registry.createEntity('torus');
  source.mesh.scale.set(3, 3, 3);
  registry.constrainEntityScale(source);
  registry.copyEntityProperties(source.id);

  registry.replaceGeometry(target, 'pyramid');
  target.mesh.position.set(-50, 50, 50);
  registry.applyCopiedProperties(target.id);

  assertInsideWorkspace(target);
});
