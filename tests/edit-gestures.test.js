import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { bindLocalInput, createTransformPreviews } from '../src/edit-gestures.js';
import { createEntityRegistry } from '../src/scene.js';

function setup() {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box');
  const published = [];
  registry.setMutationHandlers({ onChanged: (snapshot) => published.push(snapshot) });
  return { registry, entity, published };
}

test('the animation loop keeps visual rotation and bounds correction out of snapshots', () => {
  const { registry, entity, published } = setup();
  registry.setAnimation(entity, { enabled: true });
  const base = registry.serializeEntity(entity.id);
  registry.setAnimation(entity, { axis: 'x' });
  assert.equal(published.length, 2);
  published.length = 0;
  for (let index = 0; index < 20; index += 1) registry.updateAnimations(0.05);
  assert.notEqual(entity.mesh.rotation.x, base.rotation.x);
  assert.ok(entity.mesh.position.y > base.position.y);
  assert.deepEqual(registry.serializeEntity(entity.id), { ...base, animation: { ...base.animation, axis: 'x' } });
  assert.deepEqual(published, []);

  const visual = entity.mesh.rotation.x;
  registry.setAppearance(entity, '#ff0000');
  assert.equal(entity.mesh.rotation.x, visual);
  assert.deepEqual(published[0].position, base.position);
  assert.deepEqual(published[0].rotation, base.rotation);
  registry.applyEntitySnapshot({ ...published[0], color: '#00ff00' });
  assert.equal(entity.mesh.rotation.x, visual);
  registry.setAnimation(entity, { speed: 90 });
  assert.equal(entity.mesh.rotation.x, visual);
  registry.setAnimation(entity, { enabled: false });
  assert.deepEqual(entity.mesh.position.toArray(), Object.values(base.position));
  assert.equal(entity.mesh.rotation.x, base.rotation.x);
  registry.updateAnimations(0.2);
  assert.equal(entity.mesh.rotation.x, base.rotation.x);
  registry.setAnimation(entity, { enabled: true });
  registry.updateAnimations(0.1);
  assert.ok(Math.abs(entity.mesh.rotation.x - Math.PI / 20) < 1e-9);
});

test('color and speed inputs confirm only the changed value at the end of a gesture', () => {
  const { registry, entity, published } = setup();
  const color = new EventTarget();
  const speed = new EventTarget();
  const colorEdit = bindLocalInput(color, {
    getEntity: registry.getSelectedEntity,
    preview: (value, target) => target.mesh.material.color.set(value),
    restore: (target) => target.mesh.material.color.set(target.color),
    commit: (value, target) => registry.setAppearance(target, value),
  });
  bindLocalInput(speed, {
    getEntity: registry.getSelectedEntity,
    preview: (value, target) => { target.previewRotationSpeed = Number(value); },
    restore: (target) => { target.previewRotationSpeed = undefined; },
    commit: (value, target) => registry.setAnimation(target, { speed: Number(value) }),
  });
  function input(control, value) {
    control.value = value;
    control.dispatchEvent(new Event('input'));
  }
  input(color, '#00ff00');
  input(color, '#ff0000');
  input(speed, '90');
  input(speed, '120');
  assert.equal(entity.mesh.material.color.getHexString(), 'ff0000');
  assert.equal(entity.previewRotationSpeed, 120);
  assert.equal(registry.serializeEntity(entity.id).animation.speed, 45);
  assert.deepEqual(published, []);
  for (const control of [color, speed]) {
    control.dispatchEvent(new Event('change'));
    control.dispatchEvent(new Event('blur'));
  }
  assert.deepEqual(published.map((item) => [item.color, item.animation.speed]), [
    ['#ff0000', 45], ['#ff0000', 120],
  ]);
  input(color, '#ff0000');
  color.dispatchEvent(new Event('change'));
  input(speed, '140');
  speed.dispatchEvent(new Event('pointercancel'));
  speed.dispatchEvent(new Event('change'));
  input(color, '#ffffff');
  const next = registry.createEntity('sphere');
  colorEdit.cancel();
  color.dispatchEvent(new Event('change'));
  assert.equal(entity.mesh.material.color.getHexString(), 'ff0000');
  assert.equal(next.color, '#6c8cff');
  assert.equal(published.length, 2);
});

test('resetting both appearance fields publishes at most once', () => {
  const { registry, entity, published } = setup();
  registry.setAppearance(entity, '#ff0000', 'wireframe');
  published.length = 0;
  registry.setAppearance(entity, '#6c8cff', 'solid');
  registry.setAppearance(entity, '#6c8cff', 'solid');
  assert.equal(published.length, 1);
  assert.equal(published[0].color, '#6c8cff');
  assert.equal(published[0].materialMode, 'solid');
});

test('holding a range key confirms once on keyup despite multiple change events', () => {
  const control = new EventTarget();
  control.type = 'range';
  const entity = {};
  const committed = [];
  bindLocalInput(control, {
    getEntity: () => entity,
    preview: () => {},
    restore: () => {},
    commit: (value) => committed.push(value),
  });
  function dispatchKey(type) {
    control.dispatchEvent(Object.assign(new Event(type), { key: 'ArrowRight' }));
  }
  for (const value of ['46', '47', '48']) {
    dispatchKey('keydown');
    control.value = value;
    control.dispatchEvent(new Event('input'));
    control.dispatchEvent(new Event('change'));
  }
  assert.deepEqual(committed, []);
  dispatchKey('keyup');
  control.dispatchEvent(new Event('blur'));
  assert.deepEqual(committed, ['48']);
});

test('a final confirmation invalidates both timer and queued previews from the gesture', () => {
  let callback;
  let nextTimer = 0;
  const queued = [];
  const sent = [];
  const previews = createTransformPreviews((snapshot, isCurrent) => {
    queued.push(() => { if (isCurrent()) sent.push(snapshot.x); });
  }, {
    setTimeout(fn, delay) {
      assert.equal(delay, 100);
      callback = fn;
      return ++nextTimer;
    },
    clearTimeout() { callback = undefined; },
  });
  previews.start('box');
  previews.push({ id: 'box', x: 1 });
  previews.push({ id: 'box', x: 2 });
  callback();
  queued.shift()();
  assert.deepEqual(sent, [2]);
  previews.push({ id: 'box', x: 3 });
  callback();
  previews.push({ id: 'box', x: 4 });
  previews.end('box');
  sent.push('final');
  assert.equal(callback, undefined);
  previews.start('box');
  queued.shift()();
  assert.deepEqual(sent, [2, 'final']);
});
