import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import * as THREE from 'three';
import { validateGltf } from '../src/graphics/gltf-validation.js';
import { loadModelAsset } from '../src/graphics/model-assets.js';
import { modelCatalog, modelLimits, PRIVATE_MODEL, validateModelBudget } from '../src/graphics/model-settings.js';
import { createEntityRegistry } from '../src/graphics/entity-registry.js';
import { createGraphicsInspector } from '../src/graphics/graphics-inspector.js';
import { environments, prepareEnvironment } from '../src/graphics/environment-presets.js';
import { DEFAULT_LIGHTING } from '../src/graphics/lighting-settings.js';

globalThis.ProgressEvent ??= class ProgressEvent {};

const example = await readFile(new URL('../public/models/beacon.glb', import.meta.url));
const encode = (document) => new TextEncoder().encode(JSON.stringify(document));
function inlineGltf() {
  const { document, buffers } = validateGltf(example);
  document.buffers[0].uri = `data:application/octet-stream;base64,${Buffer.from(buffers[0]).toString('base64')}`;
  return document;
}

test('GLB and self-contained JSON load through GLTFLoader and preserve the hierarchy', async () => {
  for (const input of [example, encode(inlineGltf())]) {
    const asset = await loadModelAsset(input, 'Farol');
    const instance = asset.instantiate();
    const nodes = [];
    instance.traverse((object) => { if (object.isMesh) nodes.push(object); });
    assert.equal(nodes.length, 4);
    assert.notEqual(nodes[0].parent, instance);
    assert.equal(nodes[1].position.y, 1.05);
    assert.ok(nodes[1].material.isMeshStandardMaterial);
    assert.equal(asset.facts.vertices, 96);
    assert.equal(asset.facts.indices, 144);
    assert.equal(asset.facts.triangles, 48);
    assert.match(asset.facts.attributes, /position.*normal.*uv/);
    assert.ok(Math.abs(asset.facts.dimensions.y - 2) < 1e-6);
    const centered = new THREE.Box3().setFromObject(instance, true).getCenter(new THREE.Vector3());
    assert.ok(centered.length() < 1e-6);
    const ray = new THREE.Raycaster(new THREE.Vector3(0, 0, 5), new THREE.Vector3(0, 0, -1));
    const [hit] = ray.intersectObject(instance, true);
    assert.ok(hit?.object.isMesh);
    asset.release();
    asset.release();
  }
});

test('catalog bounds and metadata are checked against all three local binaries', async () => {
  assert.equal(Object.keys(modelCatalog).length, 3);
  for (const [type, item] of Object.entries(modelCatalog)) {
    const asset = await loadModelAsset(await readFile(new URL(`../public/models/${item.file}`, import.meta.url)), type);
    for (const key of ['bytes', 'vertices', 'triangles', 'materials', 'textures', 'pixels', 'meshes']) assert.equal(asset.info[key], item[key]);
    for (const [index, axis] of asset.halfSize.toArray().entries()) {
      assert.ok(axis <= item.halfSize[index] && item.halfSize[index] - axis < 1e-5);
    }
    asset.release();
  }
});

test('preflight rejects malformed GLB, URI references, topology, oversized textures and animations', () => {
  const broken = Uint8Array.from(example);
  broken[8] = 0;
  assert.throws(() => validateGltf(broken), /GLB/);
  assert.throws(() => validateGltf(new Uint8Array(modelLimits.fileBytes + 1)), /4 MiB/);
  for (const url of ['https://example.com/a.bin', './a.bin', 'blob:unsafe', 'file:///a.bin']) {
    const external = inlineGltf();
    external.buffers[0].uri = url;
    assert.throws(() => validateGltf(encode(external)), /incorporados/);
  }
  const invalid = [
    [(doc) => { doc.nodes[1].children = [0]; }, /hierarquia/],
    [(doc) => { doc.animations = [{ name: 'A' }]; }, /estáticos/],
    [(doc) => { doc.meshes[0].primitives[0].targets = []; }, /Morph/],
    [(doc) => { doc.extensionsUsed = ['KHR_draco_mesh_compression']; }, /Extensões/],
    [(doc) => { doc.accessors[0].count = 500000; }, /limites/],
    [(doc) => { doc.nodes[0].scale = [0, 1, 1]; }, /degenerada/],
    [(doc) => { doc.images = [{ uri: 'https://example.com/external.png' }]; }, /incorporados/],
  ];
  for (const [modify, reason] of invalid) {
    const document = inlineGltf();
    modify(document);
    assert.throws(() => validateGltf(encode(document)), reason);
  }
  const document = inlineGltf();
  const png = Buffer.alloc(33);
  png.writeUInt32BE(0x89504e47, 0); png.writeUInt32BE(0x0d0a1a0a, 4);
  png.writeUInt32BE(13, 8); png.write('IHDR', 12); png.writeUInt32BE(20000, 16); png.writeUInt32BE(20000, 20);
  document.images = [{ uri: `data:image/png;base64,${png.toString('base64')}` }];
  assert.throws(() => validateGltf(encode(document)), /1024/);
});

test('private imports never serialize or notify collaboration and survive a room transition', async () => {
  const asset = await loadModelAsset(example, 'Particular');
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene, undefined, undefined, { get: () => asset });
  const published = [];
  registry.setMutationHandlers({ onCreated: (entity) => published.push(entity), onChanged: (entity) => published.push(entity) });
  const privateEntity = registry.createEntity(PRIVATE_MODEL, { x: 0, y: 4, z: 0, modelAsset: asset });
  registry.setAnimation(privateEntity, { enabled: true });
  registry.setTrajectory(privateEntity, { enabled: true });
  registry.updateAnimations(0.14);
  assert.equal(published.length, 0);
  assert.deepEqual(registry.getSharedEntities(), []);
  assert.ok(registry.duplicateEntity(privateEntity.id)?.privateModel);
  assert.equal(registry.setPrivateModelsVisible(false), 2);
  assert.equal(scene.children.length, 0);
  assert.throws(() => registry.createEntity(PRIVATE_MODEL, { modelAsset: asset }), /modo local/);
  registry.createEntity('model-beacon', { x: 0, y: 4, z: 0 });
  const snapshots = JSON.parse(JSON.stringify(registry.getSharedEntities()));
  registry.replaceEntities(snapshots);
  assert.equal(registry.count(), 1);
  assert.equal(registry.setPrivateModelsVisible(true), 0);
  assert.equal(registry.count(), 3);
  assert.deepEqual(registry.getSharedEntities(), snapshots);
  registry.dispose();
  asset.release();
});

test('duplicated models share material and geometry until the last reference is released', async () => {
  const asset = await loadModelAsset(example, 'Particular');
  const registry = createEntityRegistry(new THREE.Scene());
  const original = registry.createEntity(PRIVATE_MODEL, { x: 0, y: 3, z: 0, modelAsset: asset });
  asset.release();
  const copy = registry.duplicateEntity(original.id);
  const materialOf = (entity) => entity.mesh.getObjectByProperty('isMesh', true).material;
  const material = materialOf(original);
  assert.equal(material, materialOf(copy));
  assert.equal(registry.setAppearance(copy, '#abcdef', 'wireframe'), false);
  assert.equal(registry.copyEntityProperties(copy.id), false);
  let disposed = 0;
  material.addEventListener('dispose', () => disposed++);
  registry.removeEntity(original.id);
  assert.equal(disposed, 0);
  registry.removeEntity(copy.id);
  assert.equal(disposed, 1);
  registry.dispose();
});

test('model budgets and hierarchy-aware inspection coexist with environment replacement', async () => {
  assert.throws(() => validateModelBudget(Array.from({ length: 7 }, () => ({ vertices: 0, triangles: 0, pixels: 0 }))), /seis/);
  assert.throws(() => validateModelBudget(Array.from({ length: 3 }, () => ({ vertices: 24000, triangles: 0, pixels: 0 }))), /orçamento/);
  const asset = await loadModelAsset(example, 'Farol');
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene, undefined, undefined, { get: () => asset });
  const entity = registry.createEntity('model-beacon', { x: 0, y: 1.1, z: 0 });
  assert.throws(() => registry.setAnimation(entity, { enabled: true }), /limites/);
  assert.throws(() => registry.setTrajectory(entity, { enabled: true, type: 'helix', height: -4 }), /limites/);
  const inspector = createGraphicsInspector(scene, { renderer: {}, readBaseTransform: registry.readBaseTransform,
    countObjects: registry.count, countParticles: () => 0, countLights: () => 0 });
  inspector.setOpen(true);
  let sample;
  inspector.setSampleHandler((value) => { sample = value; });
  inspector.beforeRender(entity);
  inspector.afterRender(new THREE.PerspectiveCamera());
  assert.equal(sample.facts.triangles, 48);
  assert.ok(sample.facts.sphereRadius > 1);
  assert.equal(sample.baseMatrix.elements[13], 1.1);
  const preset = prepareEnvironment(environments[0].id, 'replace',
    { entities: registry.getSharedEntities(), lighting: DEFAULT_LIGHTING, particles: {} });
  registry.applyEntityBatch(preset.entities, true);
  assert.equal(registry.getEntity(entity.id), null);
  assert.equal(registry.count(), 15);
  inspector.dispose();
  registry.dispose();
  asset.release();
});
