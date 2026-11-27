import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createSceneLighting } from '../src/graphics/scene-lighting.js';
import { changeLighting, DEFAULT_LIGHTING, sameLighting } from '../src/graphics/lighting-settings.js';
import { createLightingSession } from '../src/lighting-session.js';
import { bindLocalInput } from '../src/edit-gestures.js';

test('five sources preserve defaults and respond independently with a configurable receiver', () => {
  const scene = new THREE.Scene();
  const rig = createSceneLighting(scene);
  const light = (type) => scene.children.find((object) => object.type === type);
  const ambient = light('AmbientLight');
  const hemisphere = light('HemisphereLight');
  const directional = light('DirectionalLight');
  const point = light('PointLight');
  const spot = light('SpotLight');
  const floor = light('Mesh');
  const grid = light('GridHelper');
  assert.deepEqual([ambient, hemisphere, directional, point, spot].map((item) => item.visible),
    [false, true, true, false, false]);
  assert.equal(hemisphere.color.getHexString(), 'dce7ff');
  assert.equal(hemisphere.groundColor.getHexString(), '303747');
  assert.equal(hemisphere.intensity, 2);
  assert.deepEqual(directional.position.toArray(), [4, 7, 5]);
  assert.equal(floor.visible, false);
  assert.equal(grid.visible, true);

  let settings = changeLighting(DEFAULT_LIGHTING, 'ambient', { enabled: true, intensity: 1.2 });
  settings = changeLighting(settings, 'point', { enabled: true, distance: 12, decay: 1, castShadow: true });
  settings = changeLighting(settings, 'spot', {
    enabled: true, distance: 15, angle: 25, penumbra: 0.6, castShadow: true, targetX: 4,
  });
  settings = changeLighting(settings, 'environment', {
    floorVisible: true, gridVisible: false, floorColor: '#bcdef0', shadowQuality: 'high',
  });
  rig.apply(settings);
  assert.deepEqual([ambient, hemisphere, directional, point, spot].map((item) => item.visible),
    [true, true, true, true, true]);
  assert.equal(ambient.intensity, 1.2);
  assert.equal(point.distance, 12);
  assert.equal(point.decay, 1);
  assert.equal(point.shadow.mapSize.x, 256);
  assert.equal(point.shadow.camera.far, 12);
  assert.equal(directional.shadow.mapSize.x, 2048);
  assert.equal(spot.shadow.mapSize.x, 1024);
  assert.ok(Math.abs(new THREE.Vector3(0, 0, -15)
    .applyMatrix4(spot.shadow.camera.projectionMatrix).z - 1) < 1e-6);
  assert.equal(spot.angle, THREE.MathUtils.degToRad(25));
  assert.equal(spot.penumbra, 0.6);
  assert.deepEqual(spot.target.position.toArray(), [4, 0, 0]);
  assert.ok(directional.shadow.bias < 0 && directional.shadow.normalBias > 0);
  assert.equal(floor.visible, true);
  assert.equal(floor.receiveShadow, true);
  assert.equal(floor.castShadow, false);
  assert.equal(floor.material.color.getHexString(), 'bcdef0');
  assert.equal(grid.visible, false);
  assert.ok(floor.position.y < grid.position.y);
  rig.apply(changeLighting(settings, 'spot', null));
  assert.equal(light('SpotLight'), spot);
  assert.equal(spot.visible, false);
  assert.equal(point.visible, true);
  rig.apply(changeLighting(settings, null, null));
  assert.equal(point.visible, false);
  assert.equal(directional.shadow.mapSize.x, 1024);
  assert.equal(floor.visible, false);
  rig.dispose();
  assert.deepEqual(scene.children, []);
});

test('helpers follow lights and release resources along with resized shadow maps', () => {
  const scene = new THREE.Scene();
  const rig = createSceneLighting(scene);
  rig.setHelper('hemisphere', 'light', true);
  rig.setHelper('directional', 'light', true);
  rig.setHelper('point', 'light', true);
  rig.setHelper('spot', 'light', true);
  rig.setHelper('directional', 'shadow', true);
  rig.setHelper('spot', 'shadow', true);
  rig.setHelper('point', 'shadow', true);
  const helpers = scene.children.filter((item) => item.type.endsWith('Helper') && item.type !== 'GridHelper');
  assert.deepEqual(helpers.map((item) => item.visible), [true, true, false, false, true, false]);
  const directional = scene.children.find((item) => item.isDirectionalLight);
  const shadow = new THREE.WebGLRenderTarget(1024, 1024);
  directional.shadow.map = shadow;
  let released = 0;
  shadow.addEventListener('dispose', () => { released += 1; });
  const settings = changeLighting(DEFAULT_LIGHTING, 'environment', { shadowQuality: 'low' });
  rig.apply(changeLighting(changeLighting(settings, 'directional', { x: 2 }), 'spot', {
    enabled: true, castShadow: true,
  }));
  assert.equal(released, 1);
  assert.equal(directional.shadow.map, null);
  assert.equal(helpers[1].matrix.elements[12], 2);
  assert.equal(helpers[5].visible, true);
  rig.setHelper('directional', 'shadow', false);
  assert.equal(helpers[4].visible, false);
  const releasedHelpers = new Set();
  helpers.forEach((helper) => {
    const resource = helper.geometry ?? helper.children.find((child) => child.geometry).geometry;
    resource.addEventListener('dispose', () => releasedHelpers.add(helper));
  });
  rig.dispose();
  assert.equal(releasedHelpers.size, 6);
});

test('settings reject invalid fields, ranges and degenerate targets and normalize colors', () => {
  for (const [group, patch] of [
    [null, {}], ['unknown', {}], ['ambient', { x: 1 }], ['point', { angle: 50 }],
    ['spot', { angle: 90 }], ['spot', { penumbra: NaN }], ['directional', { enabled: 'yes' }],
    ['point', { distance: 0.1 }], ['ambient', { color: '#123456\n' }],
    ['environment', { shadowQuality: 'ultra' }], ['directional', { x: 0, y: 0, z: 0 }],
    ['hemisphere', { y: 0 }],
  ]) assert.throws(() => changeLighting(DEFAULT_LIGHTING, group, patch));
  const updated = changeLighting(DEFAULT_LIGHTING, 'ambient', { color: '#ABCDEF' });
  assert.equal(updated.ambient.color, '#abcdef');
  assert.equal(sameLighting(changeLighting(updated, 'ambient', null), DEFAULT_LIGHTING), true);
});

test('a disconnected preview is discarded and a queued confirmation survives reconnect', async () => {
  let view;
  const requests = [];
  const errors = [];
  const session = createLightingSession({
    render: (settings) => { view = settings; },
    send: (command) => new Promise((resolve, reject) => requests.push({ command, resolve, reject })),
    onError: (error) => errors.push(error),
  });
  session.resume({ revision: 0, settings: DEFAULT_LIGHTING });
  session.commit('ambient', { enabled: true });
  session.preview('point', { intensity: 100 });
  assert.equal(view.point.intensity, 100);
  session.pause();
  assert.equal(view.point.intensity, DEFAULT_LIGHTING.point.intensity);
  assert.equal(view.ambient.enabled, true);
  const peerState = changeLighting(DEFAULT_LIGHTING, 'environment', { gridVisible: false });
  session.resume({ revision: 1, settings: peerState });
  requests[0].reject(new Error('old transport'));
  await new Promise((ready) => setImmediate(ready));
  assert.equal(requests.length, 2);
  assert.deepEqual(requests[1].command, requests[0].command);
  const final = changeLighting(peerState, 'ambient', { enabled: true });
  requests[1].resolve({ revision: 2, settings: final });
  await new Promise((ready) => setImmediate(ready));
  assert.equal(view.environment.gridVisible, false);
  assert.equal(view.ambient.enabled, true);
  assert.deepEqual(errors, []);
});

test('continuous edits produce one command and preserve a concurrent field across revisions', async () => {
  let view;
  const requests = [];
  let resolve;
  const session = createLightingSession({
    render: (settings) => { view = settings; },
    send: (command) => { requests.push(command); return new Promise((ready) => { resolve = ready; }); },
    onError: assert.fail,
  });
  session.resume({ revision: 0, settings: DEFAULT_LIGHTING });
  const control = new EventTarget();
  const entity = {};
  bindLocalInput(control, {
    getEntity: () => entity,
    preview: (value) => session.preview('directional', { intensity: Number(value) }),
    restore: (_, willCommit) => { if (!willCommit) session.cancel(); },
    commit: (value) => session.commit('directional', { intensity: Number(value) }),
  });
  for (const value of ['4', '5']) {
    control.value = value;
    control.dispatchEvent(new Event('input'));
  }
  const remote = changeLighting(DEFAULT_LIGHTING, 'environment', { gridVisible: false });
  session.accept({ revision: 1, settings: remote });
  assert.equal(view.directional.intensity, 5);
  assert.equal(view.environment.gridVisible, false);
  assert.deepEqual(requests, []);
  control.dispatchEvent(new Event('change'));
  control.dispatchEvent(new Event('blur'));
  assert.deepEqual(requests, [{ group: 'directional', patch: { intensity: 5 } }]);
  const committed = changeLighting(remote, 'directional', { intensity: 5 });
  session.accept({ revision: 2, settings: committed });
  session.accept({ revision: 1, settings: remote });
  resolve({ revision: 2, settings: committed });
  await new Promise((ready) => setImmediate(ready));
  session.commit('directional', { intensity: 5 });
  assert.equal(requests.length, 1);
  assert.equal(view.environment.gridVisible, false);
  assert.equal(view.directional.intensity, 5);
});
