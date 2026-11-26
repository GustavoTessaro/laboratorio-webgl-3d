import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createScene } from '../src/scene.js';

test('disposing the scene stops rendering and releases its owned resources silently', () => {
  const ownerDocument = new EventTarget();
  const view = new EventTarget();
  ownerDocument.defaultView = view;
  ownerDocument.createElement = () => ({
    getContext: () => ({ clearRect() {}, beginPath() {}, roundRect() {}, fill() {}, fillText() {} }),
  });
  let disconnected = 0;
  view.ResizeObserver = class {
    observe() {}
    disconnect() { disconnected += 1; }
  };

  const canvas = new EventTarget();
  canvas.style = {};
  canvas.getRootNode = () => ownerDocument;
  let removed = 0;
  canvas.remove = () => { removed += 1; };
  let renders = 0;
  let resizes = 0;
  let disposed = 0;
  let contextLosses = 0;
  let loop;
  let scene;
  const renderer = {
    domElement: canvas,
    shadowMap: {},
    setPixelRatio() {},
    setSize() { resizes += 1; },
    setAnimationLoop(callback) { loop = callback; },
    render(renderedScene) { scene = renderedScene; renders += 1; },
    dispose() { disposed += 1; },
    forceContextLoss() { contextLosses += 1; },
  };
  const controls = createScene({
    ownerDocument,
    prepend(element) { assert.equal(element, canvas); },
    getBoundingClientRect: () => ({ width: 640, height: 480 }),
  }, { renderer });
  const entity = controls.getSelectedEntity();
  const mutations = [];
  controls.setCollaborationHandlers({ onEntityDeleted: (id) => mutations.push(id) });
  controls.setEntityPresence(entity.id, 'Ana');
  loop();
  const sprite = scene.children.find((object) => object.isSprite);
  const grid = scene.children.find((object) => object instanceof THREE.GridHelper);
  const selection = scene.children.find((object) => object instanceof THREE.BoxHelper);
  const light = scene.children.find((object) => object.isDirectionalLight);
  const shadowTarget = new THREE.WebGLRenderTarget(1, 1);
  light.shadow.map = shadowTarget;
  const resources = [
    entity.mesh.geometry, entity.mesh.material, sprite.material, sprite.material.map,
    grid.geometry, grid.material, selection.geometry, selection.material, shadowTarget,
  ];
  const released = new Map();
  for (const resource of resources) {
    resource.addEventListener('dispose', () => released.set(resource, (released.get(resource) ?? 0) + 1));
  }

  controls.dispose();
  controls.dispose();
  view.dispatchEvent(new Event('resize'));
  assert.equal(loop, null);
  assert.deepEqual({ renders, resizes, disconnected, disposed, removed, contextLosses }, {
    renders: 1, resizes: 1, disconnected: 1, disposed: 1, removed: 1, contextLosses: 1,
  });
  assert.deepEqual(resources.map((resource) => released.get(resource)), resources.map(() => 1));
  assert.deepEqual(mutations, []);
  assert.deepEqual(controls.getSharedEntities(), []);
  assert.deepEqual(scene.children, []);
  assert.equal(canvas.style.touchAction, 'auto');
});
