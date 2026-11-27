import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { environments, prepareEnvironment } from '../src/graphics/environment-presets.js';
import { createEntityRegistry } from '../src/graphics/entity-registry.js';
import { createGeometry, describeGeometry, geometries } from '../src/graphics/geometries.js';
import { DEFAULT_LIGHTING } from '../src/graphics/lighting-settings.js';
import { changeParticles } from '../src/graphics/particle-settings.js';

const empty = { entities: [], lighting: DEFAULT_LIGHTING, particles: {} };

test('seven reproducible presets fit the existing shape, light and particle validators', () => {
  assert.equal(new Set(environments.map(({ id }) => id)).size, 7);
  const scenes = Object.fromEntries(environments.map(({ id }) => [id, prepareEnvironment(id, 'replace', empty)]));
  assert.deepEqual(scenes['geometry-lab'].entities.map(({ type }) => type), Object.keys(geometries));
  assert.equal(new Set(scenes['material-gallery'].entities.map((entity) => entity.materialSettings?.textureId)
    .filter(Boolean)).size, 8);
  assert.equal(scenes['motion-lab'].entities.filter(({ trajectory }) => trajectory?.enabled).length, 5);
  assert.equal(Object.values(scenes['lighting-studio'].lighting).filter((light) => light.enabled).length, 5);
  assert.equal(Object.values(scenes['particle-fountain'].particles)[0].count, 1600);
  assert.deepEqual(scenes['empty-scene'].lighting, DEFAULT_LIGHTING);
  assert.deepEqual(scenes['empty-scene'].particles, {});
  for (const scene of Object.values(scenes)) {
    for (const entity of scene.entities) createGeometry(describeGeometry(entity.type, entity.geometryParameters)).dispose();
  }
});

test('add preserves room settings, creates distinct ids and rejects budgets before applying', () => {
  const fountain = prepareEnvironment('particle-fountain', 'replace', empty);
  const next = prepareEnvironment('particle-fountain', 'add', fountain);
  assert.equal(next.lighting, fountain.lighting);
  assert.equal(Object.keys(next.particles).length, 2);
  assert.equal(new Set([...fountain.entities, ...next.entities].map(({ id }) => id)).size, 4);
  assert.throws(() => prepareEnvironment('empty-scene', 'add', empty));
  assert.throws(() => prepareEnvironment('geometry-lab', 'add', {
    ...empty, entities: Array.from({ length: 86 }, () => ({ id: crypto.randomUUID() })),
  }), /100/);
  let particles = {};
  for (let i = 0; i < 4; i += 1) {
    particles = changeParticles(particles, { operation: 'add', id: crypto.randomUUID(), patch: { type: 'fountain' } });
  }
  assert.throws(() => prepareEnvironment('particle-fountain', 'add', { ...empty, particles }), /4/);
  assert.equal(Object.keys(particles).length, 4);
});

test('staged replacement disposes resources and rolls back if a mesh cannot be built', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const original = registry.createEntity('box');
  let disposed = 0;
  original.mesh.geometry.addEventListener('dispose', () => disposed++);
  const prepared = prepareEnvironment('lighting-studio', 'replace', empty);
  const invalid = { ...prepared.entities[0], id: crypto.randomUUID(), type: 'invalid' };
  assert.throws(() => registry.applyEntityBatch([prepared.entities[0], invalid], true));
  assert.equal(registry.getSelectedEntity(), original);
  assert.deepEqual(registry.getEntities(), [original]);
  registry.applyEntityBatch(prepared.entities, false);
  assert.equal(registry.getSelectedEntity(), original);
  assert.equal(registry.count(), 4);
  assert.equal(disposed, 0);
  registry.applyEntityBatch([], true);
  assert.equal(registry.count(), 0);
  assert.equal(disposed, 1);
  registry.dispose();
});
