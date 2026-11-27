import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEntityRegistry } from '../src/scene.js';
import { geometries, createGeometry, describeGeometry } from '../src/graphics/geometries.js';
import { createMaterialController, normalizeMaterialSettings } from '../src/graphics/object-materials.js';
import { createShaderDiagnostics } from '../src/graphics/shader-materials.js';
import { shaderCatalog, normalizeShader, shaderParameters } from '../src/graphics/shader-settings.js';

const shader = (id, parameters) => ({ kind: 'shader', shader: { id, parameters } });
const pool = { acquire() { return () => {}; } };

test('six safe presets create native materials with contextual defaults on all fifteen geometries', () => {
  assert.deepEqual(Object.keys(shaderCatalog), ['gradient', 'wave', 'checker', 'fresnel', 'lava', 'hologram']);
  for (const type of Object.keys(geometries)) {
    const geometry = createGeometry(describeGeometry(type));
    for (const id of Object.keys(shaderCatalog)) {
      const mesh = new THREE.Mesh(geometry, null);
      const controller = createMaterialController(mesh, pool);
      controller.apply('#123456', 'wireframe', normalizeMaterialSettings(shader(id)));
      assert.ok(mesh.material.isShaderMaterial);
      assert.equal(mesh.material.side, THREE.FrontSide);
      assert.equal(mesh.material.wireframe, true);
      assert.equal(mesh.material.depthTest, true);
      assert.equal(mesh.material.depthWrite, id !== 'hologram');
      assert.equal(mesh.castShadow, id !== 'wave');
      assert.equal(mesh.receiveShadow, false);
      assert.equal(mesh.frustumCulled, id !== 'wave');
      assert.ok(mesh.geometry.getAttribute('uv'));
      assert.ok(mesh.geometry.getAttribute('normal'));
      assert.match(mesh.material.fragmentShader, new RegExp(`LAB_SHADER_${id}`));
      controller.dispose();
    }
    geometry.dispose();
  }
});

test('descriptor validation rejects unknown ids, irrelevant fields, arbitrary GLSL and invalid values', () => {
  for (const input of [
    { id: 'unknown' }, { id: 'gradient', vertexShader: 'void main() {}' },
    { id: 'gradient', parameters: { amplitude: 0.1 } }, { id: 'gradient', parameters: { glsl: 'void main() {}' } },
    { id: 'wave', parameters: { amplitude: 0.36 } }, { id: 'wave', parameters: { speed: NaN } },
    { id: 'lava', parameters: { noiseMix: Infinity } }, { id: 'hologram', parameters: { colorB: '#wrong' } },
  ]) assert.throws(() => normalizeShader(input));
  assert.throws(() => normalizeMaterialSettings({ kind: 'shader' }));
  assert.deepEqual(shaderParameters({ id: 'checker' }), { colorB: '#f9ebc6', scale: 8 });
  assert.deepEqual(normalizeShader({ id: 'wave', parameters: { amplitude: 0.15 } }), { id: 'wave', parameters: null });
});

test('uniform edits and local time preserve material identity and version, with one useful commit', () => {
  const registry = createEntityRegistry(new THREE.Scene(), pool);
  const entity = registry.createEntity('sphere', { x: 0, y: 3, z: 0 });
  registry.setMaterialSettings(entity, shader('wave'));
  const { material } = entity.mesh;
  const base = registry.serializeEntity(entity.id);
  const changes = [];
  registry.setMutationHandlers({ onChanged: (snapshot) => changes.push(snapshot) });
  const version = material.version;
  registry.setMaterialSettings(entity, shader('wave', { amplitude: 0.19 }), true);
  registry.setMaterialSettings(entity, shader('wave', { amplitude: 0.24 }), true);
  for (let i = 0; i < 10; i += 1) registry.updateAnimations(0.05);
  assert.equal(material, entity.mesh.material);
  assert.equal(material.version, version);
  assert.equal(material.uniforms.uAmplitude.value, 0.24);
  assert.ok(Math.abs(material.uniforms.uPhase.value - 1) < 1e-10);
  assert.deepEqual(registry.serializeEntity(entity.id), base);
  registry.setMaterialSettings(entity, shader('wave', { amplitude: 0.24 }));
  registry.setMaterialSettings(entity, shader('wave', { amplitude: 0.24 }));
  assert.equal(changes.length, 1);
  assert.equal(changes[0].materialSettings.shader.parameters.amplitude, 0.24);
  assert.equal(material.version, version);
  registry.dispose();
});

test('GPU wave bounds validate scale, rotated Y displacement, trajectories and copied properties', () => {
  const registry = createEntityRegistry(new THREE.Scene(), pool);
  const nearFloor = registry.createEntity('box', { x: 0, y: 0.75, z: 0 });
  assert.throws(() => registry.setMaterialSettings(nearFloor, shader('wave')), /limites/);
  const nearWall = registry.createEntity('box', { x: 9.15, y: 3, z: 0,
    rotation: new THREE.Euler(0, 0, Math.PI / 2) });
  assert.throws(() => registry.setMaterialSettings(nearWall, shader('wave')), /limites/);
  const elevated = registry.createEntity('box', { x: 0, y: 3, z: 0 });
  registry.setMaterialSettings(elevated, shader('wave', { amplitude: 0.35 }));
  registry.setAnimation(elevated, { enabled: true });
  registry.setTrajectory(elevated, { enabled: true, radius: 1 });
  assert.throws(() => registry.setTrajectory(elevated, { enabled: true, type: 'helix', height: -2 }), /limites/);
  registry.copyEntityProperties(elevated.id);
  assert.equal(registry.applyCopiedProperties(nearFloor.id), false);
  const duplicate = registry.duplicateEntity(elevated.id);
  assert.deepEqual(duplicate.materialSettings.shader, elevated.materialSettings.shader);
  const snapshots = JSON.parse(JSON.stringify(registry.getSharedEntities()));
  registry.replaceEntities(snapshots);
  assert.deepEqual(registry.getSharedEntities(), snapshots);
  registry.dispose();
});

test('switching retains conventional settings and disposing a shader releases the material', () => {
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), null);
  const controller = createMaterialController(mesh, pool);
  const conventional = { kind: 'phong', textureId: 'wood', shininess: 79 };
  const mixed = normalizeMaterialSettings({ ...conventional, ...shader('fresnel', { power: 4 }) });
  controller.apply('#123456', 'solid', mixed);
  let disposed = 0;
  mesh.material.addEventListener('dispose', () => disposed++);
  controller.apply('#123456', 'solid', normalizeMaterialSettings({ ...mixed, kind: 'phong' }));
  assert.equal(mesh.material.shininess, 79);
  assert.equal(disposed, 1);
  assert.equal(mixed.textureId, 'wood');
  controller.dispose();
  mesh.geometry.dispose();
});

test('shader diagnostics select fallback for the failed preset and restore the existing renderer hook', () => {
  const previous = () => {};
  const renderer = { debug: { onShaderError: previous } };
  const diagnostics = createShaderDiagnostics(renderer);
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), null);
  const controller = createMaterialController(mesh, pool, diagnostics.failed);
  const settings = normalizeMaterialSettings(shader('wave'));
  controller.apply('#123456', 'solid', settings);
  renderer.debug.onShaderError({ getShaderSource: () => '#define LAB_SHADER_wave 1', getProgramInfoLog: () => 'test' });
  assert.equal(diagnostics.refresh(), true);
  controller.refreshFallback();
  assert.ok(mesh.material.isMeshBasicMaterial);
  assert.ok(mesh.castShadow);
  assert.ok(mesh.frustumCulled);
  assert.equal(mesh.userData.shaderFallback, true);
  controller.dispose();
  mesh.geometry.dispose();
  diagnostics.dispose();
  assert.equal(renderer.debug.onShaderError, previous);
});
