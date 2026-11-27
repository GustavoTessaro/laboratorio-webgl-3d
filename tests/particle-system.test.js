import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createParticleSystem } from '../src/graphics/particle-system.js';
import {
  changeParticles, EMPTY_PARTICLES, PARTICLE_BUDGET, PARTICLE_TYPES, particleDefaults, sameParticleSettings,
} from '../src/graphics/particle-settings.js';
import { createRoomSettingsSession } from '../src/room-settings-session.js';
import { bindLocalInput } from '../src/edit-gestures.js';

const ids = [1, 2, 3, 4, 5].map((value) => `00000000-0000-4000-8000-00000000000${value}`);
const command = (operation, id, patch = null) => ({ operation, id, patch });
const positions = (points) => points.geometry.getAttribute('position').array.slice(0, points.geometry.drawRange.count * 3);

test('the four effects produce deterministic point clouds in reusable buffers', () => {
  const first = new THREE.Scene();
  const second = new THREE.Scene();
  const a = createParticleSystem(first, 8, 2);
  const b = createParticleSystem(second, 8, 2);
  const config = Object.fromEntries(PARTICLE_TYPES.map((type, index) => [
    ids[index], { ...particleDefaults(type), count: 48, seed: 123, size: 12 },
  ]));
  a.apply(config);
  b.apply(config);
  assert.equal(first.children.length, 4);
  for (const [index, object] of first.children.entries()) {
    assert.ok(object.isPoints);
    assert.ok(object.material.isPointsMaterial);
    assert.ok(object.geometry.getAttribute('position').array instanceof Float32Array);
    assert.equal(object.geometry.drawRange.count, 48);
    assert.equal(object.material.size, 4);
    assert.equal(object.material.depthWrite, false);
    assert.equal(object.material.depthTest, true);
    assert.equal(object.material.blending, index === 3 ? THREE.AdditiveBlending : THREE.NormalBlending);
    assert.deepEqual(positions(object), positions(second.children[index]));
  }
  const original = first.children.map(positions);
  const geometries = first.children.map((child) => child.geometry);
  const materials = first.children.map((child) => child.material);
  for (let i = 0; i < 30; i += 1) {
    a.update(0.02);
    b.update(0.02);
  }
  first.children.forEach((object, index) => {
    assert.notDeepEqual(positions(object), original[index]);
    assert.deepEqual(positions(object), positions(second.children[index]));
    assert.equal(object.geometry, geometries[index]);
    assert.equal(object.material, materials[index]);
  });
  a.dispose();
  b.dispose();
});

test('delta is capped and playback, pause and restart are local runtime operations', () => {
  const scene = new THREE.Scene();
  const system = createParticleSystem(scene);
  const settings = { [ids[0]]: { ...particleDefaults('fountain'), count: 5 } };
  system.apply(settings);
  const points = scene.children[0];
  const initial = positions(points);
  system.update(8);
  const clipped = positions(points);
  assert.notDeepEqual(initial, clipped);
  system.restart(ids[0]);
  assert.deepEqual(positions(points), initial);
  system.update(0.05);
  assert.deepEqual(positions(points), clipped);
  system.setPlaying(ids[0], false);
  assert.equal(system.isPlaying(ids[0]), false);
  system.update(0.03);
  assert.deepEqual(positions(points), clipped);
  system.setPlaying(ids[0], true);
  system.update(0.03);
  assert.notDeepEqual(positions(points), clipped);
  system.apply({ [ids[0]]: { ...settings[ids[0]], enabled: false } });
  const stopped = positions(points);
  system.update(0.03);
  assert.equal(points.visible, false);
  assert.deepEqual(positions(points), stopped);
});

test('fountain gravity and weather wind change trajectories, and both recycle', () => {
  const scene = new THREE.Scene();
  const system = createParticleSystem(scene);
  let effects = Object.fromEntries([0, 1].map((index) => [
    ids[index], { ...particleDefaults('fountain'), gravity: index ? 18 : 0, count: 1, life: 2 },
  ]));
  system.apply(effects);
  assert.ok(positions(scene.children[0])[1] > positions(scene.children[1])[1]);
  let previous = positions(scene.children[0])[1];
  let recycled = false;
  for (let i = 0; i < 41; i += 1) {
    system.update(0.05);
    const y = positions(scene.children[0])[1];
    recycled ||= previous > 2 && y < 1;
    previous = y;
  }
  assert.ok(recycled);
  effects = Object.fromEntries([0, 1].map((index) => [
    ids[index], { ...particleDefaults('rain'), wind: index ? 3 : 0, count: 1 },
  ]));
  system.apply(effects);
  let rise = false;
  previous = positions(scene.children[0])[1];
  for (let i = 0; i < 41; i += 1) {
    system.update(0.05);
    const y = positions(scene.children[0])[1];
    rise ||= y > previous + 0.5;
    previous = y;
  }
  assert.equal(positions(scene.children[0])[1], positions(scene.children[1])[1]);
  assert.notEqual(positions(scene.children[0])[0], positions(scene.children[1])[0]);
  assert.ok(rise);
});

test('appearance updates reuse resources, and removal frees them and the shared point texture', () => {
  const scene = new THREE.Scene();
  const system = createParticleSystem(scene);
  const config = { ...particleDefaults('fountain'), count: 10 };
  system.apply({ [ids[0]]: config, [ids[1]]: config });
  const [first, second] = scene.children;
  const buffer = first.geometry.getAttribute('position');
  const version = buffer.version;
  let disposals = 0;
  for (const resource of [first.geometry, first.material, second.geometry, second.material, first.material.map]) {
    resource.addEventListener('dispose', () => { disposals += 1; });
  }
  system.apply({ [ids[0]]: { ...config, color: '#aabbcc', opacity: 0.3 }, [ids[1]]: config });
  assert.equal(buffer.version, version);
  assert.equal(first.material.color.getHexString(), 'aabbcc');
  assert.equal(first.material.opacity, 0.3);
  system.apply({ [ids[0]]: { ...config, count: 20 } });
  assert.equal(disposals, 2);
  assert.equal(first.geometry.getAttribute('position'), buffer);
  assert.equal(first.geometry.drawRange.count, 20);
  system.dispose();
  system.dispose();
  assert.equal(disposals, 5);
  assert.deepEqual(scene.children, []);
});

test('effect validation restricts context, budgets and spawn bounds, including inactive effects', () => {
  let effects = EMPTY_PARTICLES;
  effects = changeParticles(effects, command('add', ids[0], { type: 'fountain', count: 5000 }));
  effects = changeParticles(effects, command('add', ids[1], { type: 'rain', count: 5000, enabled: false }));
  effects = changeParticles(effects, command('add', ids[2], { type: 'snow', count: 1999 }));
  effects = changeParticles(effects, command('add', ids[3], { type: 'galaxy', count: 1 }));
  assert.equal(Object.values(effects).reduce((total, effect) => total + effect.count, 0), PARTICLE_BUDGET.total);
  for (const patch of [{ count: 5001 }, { count: 1.5 }, { x: 11 }, { y: -1 }, { seed: -1 },
    { type: 'alien' }, { wind: 1 }, { color: 'white' }, { life: NaN }]) {
    assert.throws(() => changeParticles(effects, command('patch', ids[0], patch)));
  }
  assert.throws(() => changeParticles(effects, command('patch', ids[3], { count: 2 })), /Orçamento/);
  assert.throws(() => changeParticles(effects, command('add', ids[4], { type: 'rain' })), /Limite/);
  const changed = changeParticles(effects, command('patch', ids[0], { type: 'galaxy' }));
  assert.equal(changed[ids[0]].count, 5000);
  assert.equal(changed[ids[0]].arms, 4);
  assert.equal(changed[ids[0]].gravity, undefined);
  assert.equal(changeParticles(changed, command('reset', ids[0]))[ids[0]].count, 1000);
  assert.equal(sameParticleSettings(effects, JSON.parse(JSON.stringify(effects))), true);
});

test('a local preview and running frames publish nothing, and one gesture commits only its field', async () => {
  const sent = [];
  const scene = new THREE.Scene();
  const system = createParticleSystem(scene);
  let resolve;
  const session = createRoomSettingsSession({
    initial: EMPTY_PARTICLES, change: changeParticles, equal: sameParticleSettings, stateValue: (state) => state.effects,
    render: system.apply, onError: assert.fail,
    send: (request) => { sent.push(request); return new Promise((ready) => { resolve = ready; }); },
  });
  const initial = changeParticles(EMPTY_PARTICLES, command('add', ids[0], { type: 'fountain' }));
  session.resume({ revision: 1, effects: initial });
  const input = new EventTarget();
  bindLocalInput(input, {
    getEntity: () => ids[0],
    preview: (value) => session.preview(command('patch', ids[0], { speed: Number(value) })),
    restore: (_, commits) => { if (!commits) session.cancel(); },
    commit: (value) => session.commit(command('patch', ids[0], { speed: Number(value) })),
  });
  for (const value of ['7', '8']) {
    input.value = value;
    input.dispatchEvent(new Event('input'));
  }
  const peer = changeParticles(initial, command('patch', ids[0], { color: '#ff0000' }));
  assert.equal(session.accept({ revision: 2, effects: peer }), undefined);
  for (let i = 0; i < 100; i += 1) system.update(0.016);
  assert.deepEqual(sent, []);
  assert.equal(scene.children[0].material.color.getHexString(), 'ff0000');
  input.dispatchEvent(new Event('change'));
  input.dispatchEvent(new Event('blur'));
  assert.deepEqual(sent, [command('patch', ids[0], { speed: 8 })]);
  resolve({ revision: 3, effects: changeParticles(peer, sent[0]) });
  await new Promise((ready) => setImmediate(ready));
  system.setPlaying(ids[0], false);
  system.restart(ids[0]);
  assert.equal(sent.length, 1);
  system.dispose();
});
