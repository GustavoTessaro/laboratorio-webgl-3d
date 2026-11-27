import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { bindLocalInput } from '../src/edit-gestures.js';
import { createEntityRegistry } from '../src/scene.js';
import {
  createTexturePool, MATERIAL_DEFAULTS, normalizeMaterialSettings, SOLID_MATERIAL, TEXTURE_TRANSFORM,
} from '../src/graphics/object-materials.js';

const settle = () => new Promise((resolve) => setImmediate(resolve));

test('legacy appearance is Standard and switches preserve settings and authored pose', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box');
  const initial = registry.serializeEntity(entity.id);
  assert.equal(initial.materialSettings, null);
  assert.equal(entity.mesh.material.type, 'MeshStandardMaterial');
  assert.equal(entity.mesh.material.roughness, 0.38);
  assert.equal(entity.mesh.material.metalness, 0.12);
  assert.equal(entity.mesh.material.color.getHexString(), '6c8cff');
  const geometry = entity.mesh.geometry;
  let disposed = 0;
  entity.mesh.material.addEventListener('dispose', () => { disposed += 1; });
  const phong = {
    kind: 'phong', opacity: 0.4, shininess: 81, specular: '#FFEEAA', side: 'double',
    emissive: '#123456', emissiveIntensity: 2,
  };
  registry.setMaterialSettings(entity, phong);
  const material = entity.mesh.material;
  assert.equal(disposed, 1);
  assert.equal(material.type, 'MeshPhongMaterial');
  assert.equal(material.shininess, 81);
  assert.equal(material.specular.getHexString(), 'ffeeaa');
  assert.equal(material.emissive.getHexString(), '123456');
  assert.equal(material.emissiveIntensity, 2);
  assert.equal(material.side, THREE.DoubleSide);
  assert.equal(material.transparent, true);
  assert.equal(material.depthWrite, false);
  registry.setMaterialSettings(entity, { ...entity.materialSettings, opacity: 1, transparent: true });
  assert.equal(entity.mesh.material, material);
  assert.equal(material.transparent, true);
  registry.setMaterialSettings(entity, { ...entity.materialSettings, kind: 'basic', transparent: false, side: 'back' });
  assert.equal(entity.mesh.material.type, 'MeshBasicMaterial');
  assert.equal(entity.mesh.material.side, THREE.BackSide);
  assert.equal(entity.mesh.material.transparent, false);
  assert.equal(entity.mesh.material.depthWrite, true);
  registry.setMaterialSettings(entity, { ...entity.materialSettings, kind: 'phong' });
  assert.equal(entity.mesh.material.shininess, 81);
  assert.equal(entity.mesh.geometry, geometry);
  assert.deepEqual(registry.serializeEntity(entity.id).position, initial.position);
  assert.deepEqual(registry.serializeEntity(entity.id).animation, initial.animation);
});

test('texture views share an image and keep transforms independent through copy, hydration and disposal', async () => {
  const original = new THREE.Texture();
  let loads = 0;
  let sourceDisposals = 0;
  original.addEventListener('dispose', () => { sourceDisposals += 1; });
  const pool = createTexturePool({ loadAsync: async () => { loads += 1; return original; } });
  const registry = createEntityRegistry(new THREE.Scene(), pool);
  const source = registry.createEntity('box');
  const target = registry.createEntity('torus');
  registry.setMaterialSettings(source, { textureId: 'wood', repeatU: 2, offsetV: 0.2, textureRotation: 90 });
  const copy = registry.duplicateEntity(source.id);
  registry.copyEntityProperties(source.id);
  registry.applyCopiedProperties(target.id);
  await settle();
  const [sourceMap, targetMap, copyMap] = [source, target, copy].map((entity) => entity.mesh.material.map);
  assert.equal(loads, 1);
  assert.notEqual(sourceMap, targetMap);
  assert.notEqual(sourceMap, copyMap);
  assert.equal(sourceMap.source, targetMap.source);
  assert.equal(sourceMap.colorSpace, THREE.SRGBColorSpace);
  assert.equal(sourceMap.wrapS, THREE.RepeatWrapping);
  assert.equal(sourceMap.rotation, Math.PI / 2);
  assert.deepEqual(sourceMap.repeat.toArray(), [2, 1]);
  assert.deepEqual(sourceMap.center.toArray(), [0.5, 0.5]);
  registry.setMaterialSettings(source, { ...source.materialSettings, kind: 'phong' });
  assert.equal(source.mesh.material.map, sourceMap);
  assert.equal(loads, 1);
  registry.setMaterialSettings(target, { ...target.materialSettings, repeatU: 4 });
  assert.equal(target.mesh.material.map, targetMap);
  assert.equal(targetMap.repeat.x, 4);
  assert.equal(sourceMap.repeat.x, 2);
  registry.setMaterialSettings(target, { ...target.materialSettings, ...TEXTURE_TRANSFORM });
  assert.deepEqual(targetMap.repeat.toArray(), [1, 1]);
  assert.deepEqual(targetMap.offset.toArray(), [0, 0]);
  const snapshot = registry.serializeEntity(source.id);
  const peer = createEntityRegistry(new THREE.Scene(), pool);
  const reloaded = peer.applyEntitySnapshot(snapshot);
  await settle();
  assert.equal(reloaded.mesh.material.map.offset.y, 0.2);
  assert.deepEqual(peer.serializeEntity(source.id), snapshot);
  let disposals = 0;
  sourceMap.addEventListener('dispose', () => { disposals += 1; });
  registry.setMaterialSettings(source, { ...source.materialSettings, textureId: null });
  assert.equal(source.mesh.material.map, null);
  assert.equal(disposals, 1);
  registry.dispose();
  assert.equal(sourceDisposals, 0);
  peer.dispose();
  assert.equal(sourceDisposals, 1);
});

test('late and failed textures do not reappear after removal or override the fallback color', async () => {
  let complete;
  const delayed = new THREE.Texture();
  let disposed = 0;
  delayed.addEventListener('dispose', () => { disposed += 1; });
  const registry = createEntityRegistry(new THREE.Scene(), createTexturePool({
    loadAsync: (url) => url.endsWith('wood.jpg') ? new Promise((resolve) => { complete = resolve; })
      : Promise.reject(new Error('file unavailable')),
  }));
  const entity = registry.createEntity();
  registry.setMaterialSettings(entity, { textureId: 'wood' });
  registry.setMaterialSettings(entity, { textureId: 'stone' });
  complete(delayed);
  await settle();
  assert.equal(disposed, 1);
  assert.equal(entity.mesh.material.map, null);
  assert.equal(entity.mesh.userData.textureStatus, 'error');
  assert.equal(entity.mesh.material.color.getHexString(), '6c8cff');
  assert.equal(registry.serializeEntity(entity.id).materialSettings.textureId, 'stone');
});

test('a range gesture publishes only its final setting, and appearance reset is idempotent', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity();
  const snapshots = [];
  registry.setMutationHandlers({ onChanged: (snapshot) => snapshots.push(snapshot) });
  const input = new EventTarget();
  bindLocalInput(input, {
    getEntity: () => entity,
    preview: (value) => registry.setMaterialSettings(entity, { opacity: Number(value) }, true),
    restore: (_, willCommit) => { if (!willCommit) registry.setMaterialSettings(entity, entity.materialSettings, true); },
    commit: (value) => registry.setMaterialSettings(entity, { opacity: Number(value) }),
  });
  for (const value of ['0.8', '0.5']) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  assert.equal(entity.mesh.material.opacity, 0.5);
  assert.equal(registry.serializeEntity(entity.id).materialSettings, null);
  assert.deepEqual(snapshots, []);
  input.dispatchEvent(new Event('change'));
  input.dispatchEvent(new Event('blur'));
  assert.equal(snapshots.length, 1);
  assert.equal(snapshots[0].materialSettings.opacity, 0.5);
  registry.setAppearance(entity, SOLID_MATERIAL.color, 'solid', null);
  registry.setAppearance(entity, SOLID_MATERIAL.color, 'solid', null);
  assert.equal(snapshots.length, 2);
  assert.equal(snapshots[1].materialSettings, null);
  assert.deepEqual(entity.materialSettings, MATERIAL_DEFAULTS);
});

test('invalid material or texture settings are rejected', () => {
  for (const invalid of [
    { kind: 'shader' }, { side: 'both' }, { opacity: -1 }, { roughness: 2 }, { metalness: NaN },
    { repeatV: 0 }, { offsetU: 2 }, { textureRotation: 181 }, { shininess: 201 }, { emissive: '#oops' },
    { transparent: 'true' }, { textureId: 'https://example.com/asset.jpg' }, { normalMap: 'wood' },
  ]) assert.throws(() => normalizeMaterialSettings(invalid));
});
