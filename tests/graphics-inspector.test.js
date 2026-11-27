import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { createEntityRegistry } from '../src/scene.js';
import { createGeometry, describeGeometry, geometries } from '../src/graphics/geometries.js';
import { inspectGeometry, matrixValue, sampleIndices, INSPECTOR_SAMPLE_LIMIT } from '../src/graphics/inspection-data.js';
import { createInspectionHelpers, INSPECTION_OVERLAYS } from '../src/graphics/inspection-helpers.js';
import { createFrameHistory, createGraphicsInspector, readRendererCounters } from '../src/graphics/graphics-inspector.js';

const counts = {
  box: [24, 8, 36, 12],
  sphere: [825, 738, 4416, 1472],
  pyramid: [19, 6, 24, 8],
  torus: [833, 768, 4608, 1536],
  cylinder: [196, 66, 384, 128],
  cone: [131, 34, 192, 64],
  plane: [4, 4, 6, 2],
  capsule: [450, 386, 2448, 816],
  tetrahedron: [12, 4, 0, 4],
  octahedron: [24, 6, 0, 8],
  dodecahedron: [108, 20, 0, 36],
  icosahedron: [60, 12, 0, 20],
  torusKnot: [845, 768, 4608, 1536],
};

const close = (actual, expected) => assert.ok(actual.distanceTo(expected) < 1e-6,
  `${actual.toArray()} differs from ${expected.toArray()}`);

test('reads the stored topology and distinct positions of all thirteen default geometries', () => {
  assert.deepEqual(Object.keys(counts), Object.keys(geometries));
  for (const [type, expected] of Object.entries(counts)) {
    const geometry = createGeometry(describeGeometry(type));
    const info = inspectGeometry(geometry);
    assert.deepEqual([info.vertices, info.unique, info.indices, info.triangles], expected, type);
    assert.equal(info.indexed, expected[2] > 0);
    assert.match(info.attributes, /position/);
    assert.match(info.attributes, /normal/);
    assert.match(info.attributes, /uv/);
    assert.equal(inspectGeometry(geometry), info);
    geometry.dispose();
  }
});

test('bounds measure actual local vertices and parameter changes yield new facts', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const entity = registry.createEntity('tetrahedron');
  const previous = inspectGeometry(entity.mesh.geometry);
  assert.ok(previous.dimensions.x < entity.geometrySpec.halfSize.x * 2);
  assert.ok(Math.abs(previous.sphereRadius - entity.geometrySpec.parameters.radius) < 1e-6);
  registry.setGeometry(entity, 'tetrahedron', { radius: 1.2, detail: 1 });
  const updated = inspectGeometry(entity.mesh.geometry);
  assert.notEqual(updated, previous);
  assert.equal(updated.vertices, 48);
  assert.equal(updated.triangles, 16);
  assert.ok(updated.dimensions.y > previous.dimensions.y);
  assert.ok(Math.abs(updated.sphereRadius - 1.2) < 1e-6);
  registry.dispose();
});

test('column-major storage is read as mathematical rows and columns', () => {
  const matrix = new THREE.Matrix4().set(
    1, 2, 3, 4,
    5, 6, 7, 8,
    9, 10, 11, 12,
    13, 14, 15, 16,
  );
  assert.deepEqual(matrix.elements.slice(0, 4), [1, 5, 9, 13]);
  assert.deepEqual(Array.from({ length: 4 }, (_, row) => matrixValue(matrix, row, 3)), [4, 8, 12, 16]);
  const translation = new THREE.Matrix4().makeTranslation(2, -3, 4);
  assert.equal(matrixValue(translation, 1, 3), -3);
  assert.equal(matrixValue(translation, 3, 1), 0);
});

test('helpers sample bounded buffers, follow visual transforms and release replaced geometry', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const entity = registry.createEntity('sphere', {
    x: 0, y: 3, z: 0, scale: new THREE.Vector3(0.7, 1.5, 1.2),
    rotation: new THREE.Euler(0.3, 0.2, 0.1),
    animation: { enabled: true, axis: 'y', speed: 60 },
  });
  const helpers = createInspectionHelpers(scene);
  helpers.setOpen(true);
  for (const overlay of INSPECTION_OVERLAYS) helpers.setEnabled(overlay, true);
  registry.updateAnimations(0.2);
  helpers.update(entity.mesh);
  scene.updateMatrixWorld();
  const group = scene.children.find((item) => item.isGroup);
  const vertexOverlay = group.children.find((item) => item.isPoints);
  const normalLines = scene.children.find((item) => item.isLineSegments);
  const normals = normalLines.geometry.getAttribute('position');
  assert.equal(vertexOverlay.geometry.getAttribute('position').count, INSPECTOR_SAMPLE_LIMIT);
  assert.equal(normals.count / 2, INSPECTOR_SAMPLE_LIMIT);
  assert.equal(entity.mesh.material.wireframe, false);
  assert.deepEqual(group.matrixWorld.elements, entity.mesh.matrixWorld.elements);
  const origin = new THREE.Vector3().fromBufferAttribute(normals, 0);
  const end = new THREE.Vector3().fromBufferAttribute(normals, 1);
  const expectedDirection = new THREE.Vector3().fromBufferAttribute(entity.mesh.geometry.attributes.normal, 0)
    .applyNormalMatrix(new THREE.Matrix3().getNormalMatrix(entity.mesh.matrixWorld));
  close(end.sub(origin).normalize(), expectedDirection);

  const version = normals.version;
  helpers.update(entity.mesh);
  assert.equal(normals.version, version);
  helpers.setOpen(false);
  helpers.update(entity.mesh);
  assert.equal(group.visible, false);
  assert.equal(normalLines.visible, false);
  assert.equal(normals.version, version);
  helpers.setOpen(true);
  helpers.update(entity.mesh);
  assert.equal(normalLines.geometry.getAttribute('position'), normals);
  registry.updateAnimations(0.05);
  helpers.update(entity.mesh);
  assert.ok(normals.version > version);

  let released = 0;
  for (const overlay of [...group.children, normalLines]) {
    overlay.geometry.addEventListener('dispose', () => { released += 1; });
    overlay.material.addEventListener('dispose', () => { released += 1; });
  }
  registry.setGeometry(entity, 'sphere', { widthSegments: 12, heightSegments: 8 });
  helpers.update(entity.mesh);
  assert.equal(released, 10);
  const duplicate = registry.duplicateEntity(entity.id);
  helpers.update(duplicate.mesh);
  helpers.update(entity.mesh);
  registry.removeEntity(entity.id);
  helpers.update(null);
  assert.equal(group.children.length, 0);
  assert.equal(scene.children.some((item) => item.isLineSegments), false);
  helpers.dispose();
  registry.dispose();
  assert.deepEqual(scene.children, []);
});

test('sampling is deterministic and missing normals do not prevent other overlays', () => {
  const sampled = sampleIndices(8192);
  assert.equal(sampled.length, 512);
  assert.equal(new Set(sampled).size, 512);
  assert.equal(sampled[1], 16);
  assert.deepEqual(Array.from(sampleIndices(3)), [0, 1, 2]);
  assert.equal(sampleIndices(0).length, 0);

  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshBasicMaterial());
  mesh.geometry.deleteAttribute('normal');
  scene.add(mesh);
  const helpers = createInspectionHelpers(scene);
  helpers.setOpen(true);
  helpers.setEnabled('normals', true);
  helpers.setEnabled('box', true);
  helpers.update(mesh);
  assert.equal(scene.children.length, 2);
  assert.equal(scene.children[1].children.length, 1);
  helpers.dispose();
  mesh.geometry.dispose();
  mesh.material.dispose();
});

test('the frame history uses real intervals, throttles samples and resets after a long pause', () => {
  const history = createFrameHistory();
  const reports = [];
  for (let frame = 0; frame <= 75; frame += 1) {
    const now = frame * 20;
    if (history.record(now)) reports.push(now);
  }
  assert.deepEqual(reports, [0, 200, 400, 600, 800, 1000, 1200, 1400]);
  assert.equal(history.length, 60);
  assert.equal(history.frameMs, 20);
  assert.equal(history.fps, 50);
  assert.equal(history.at(0), 20);
  assert.equal(history.record(3000), true);
  assert.equal(history.length, 0);
  assert.equal(history.fps, null);
});

test('the inspector separates authored and rendered poses, and samples without an object', () => {
  const scene = new THREE.Scene();
  const registry = createEntityRegistry(scene);
  const entity = registry.createEntity('box', { x: 2, y: 2, z: 1 });
  entity.animation.enabled = true;
  const before = registry.serializeEntity(entity.id);
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 10);
  camera.position.z = 5;
  camera.updateMatrixWorld();
  let time = 0;
  const renderer = { info: {
    render: { calls: 4, triangles: 12, points: 40, lines: 65 },
    memory: { geometries: 7, textures: 2 },
  } };
  const inspector = createGraphicsInspector(scene, {
    renderer, readBaseTransform: registry.readBaseTransform, countObjects: registry.count,
    countParticles: () => 40, countLights: () => 2, now: () => time,
  });
  const frames = [];
  inspector.setSampleHandler((sample) => {
    frames.push({
      facts: sample.facts, counters: { ...sample.counters }, base: sample.baseMatrix?.clone(),
      visual: sample.entity?.mesh.matrix.clone(), view: sample.camera.matrixWorldInverse.clone(),
    });
  });
  inspector.beforeRender(entity);
  inspector.afterRender(camera);
  assert.deepEqual(frames, []);
  inspector.setOpen(true);
  registry.updateAnimations(0.5);
  entity.mesh.updateMatrixWorld();
  inspector.beforeRender(entity);
  inspector.afterRender(camera);
  assert.equal(frames[0].facts.vertices, 24);
  assert.deepEqual(frames[0].counters, {
    calls: 4, triangles: 12, points: 40, lines: 65, geometries: 7, textures: 2,
    objects: 1, particles: 40, lights: 2,
  });
  assert.equal(matrixValue(frames[0].base, 0, 3), 2);
  assert.notDeepEqual(frames[0].base.elements, frames[0].visual.elements);
  assert.deepEqual(registry.serializeEntity(entity.id), before);
  time = 199;
  inspector.afterRender(camera);
  assert.equal(frames.length, 1);
  time = 200;
  registry.removeEntity(entity.id);
  inspector.beforeRender(null);
  inspector.afterRender(camera);
  assert.equal(frames[1].facts, null);
  assert.equal(frames[1].counters.objects, 0);
  assert.deepEqual(frames[1].view.elements, frames[0].view.elements);
  assert.equal(readRendererCounters(undefined, {}).calls, null);
  inspector.dispose();
});
