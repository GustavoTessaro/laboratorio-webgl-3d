import * as THREE from 'three';
import { inspectGeometry } from './inspection-data.js';
import { createInspectionHelpers } from './inspection-helpers.js';

export const INSPECTOR_INTERVAL_MS = 200;
const HISTORY_LENGTH = 60;

export function createFrameHistory() {
  const values = new Float64Array(HISTORY_LENGTH);
  let previous = null;
  let nextSample = -Infinity;
  let next = 0;
  let count = 0;
  let total = 0;

  function reset() {
    previous = null;
    nextSample = -Infinity;
    next = count = total = 0;
  }

  return {
    get length() { return count; },
    get frameMs() { return count ? values[(next + HISTORY_LENGTH - 1) % HISTORY_LENGTH] : null; },
    get fps() { return count ? 1000 * count / total : null; },
    at(index) { return values[(next + HISTORY_LENGTH - count + index) % HISTORY_LENGTH]; },
    record(now) {
      if (previous !== null) {
        const elapsed = now - previous;
        if (elapsed > 1000 || elapsed < 0) reset();
        else if (elapsed > 0) {
          if (count === HISTORY_LENGTH) total -= values[next];
          else count += 1;
          values[next] = elapsed;
          total += elapsed;
          next = (next + 1) % HISTORY_LENGTH;
        }
      }
      previous = now;
      if (now < nextSample) return false;
      nextSample = now + INSPECTOR_INTERVAL_MS;
      return true;
    },
    reset,
  };
}

export function readRendererCounters(info, result) {
  const render = info?.render;
  const memory = info?.memory;
  result.calls = render?.calls ?? null;
  result.triangles = render?.triangles ?? null;
  result.points = render?.points ?? null;
  result.lines = render?.lines ?? null;
  result.geometries = memory?.geometries ?? null;
  result.textures = memory?.textures ?? null;
  return result;
}

export function createGraphicsInspector(scene, {
  renderer, readBaseTransform, countObjects, countParticles, countLights,
  now = () => performance.now(),
}) {
  const helpers = createInspectionHelpers(scene);
  const history = createFrameHistory();
  const base = { position: new THREE.Vector3(), rotation: new THREE.Euler(), scale: new THREE.Vector3() };
  const baseMatrix = new THREE.Matrix4();
  const quaternion = new THREE.Quaternion();
  const sample = { entity: null, facts: null, base: null, baseMatrix: null, camera: null, counters: {}, history };
  let entity;
  let open = false;
  let onSample = () => {};

  return {
    setOpen(value) {
      if (Boolean(value) === open) return;
      open = Boolean(value);
      helpers.setOpen(open);
      history.reset();
    },
    setOverlay: helpers.setEnabled,
    setSampleHandler(handler = () => {}) { onSample = handler; },
    beforeRender(selected) {
      entity = selected;
      helpers.update(selected?.mesh);
    },
    afterRender(camera) {
      if (!open || !history.record(now())) return;
      const authored = entity && readBaseTransform(entity.id, base);
      sample.entity = entity ?? null;
      sample.facts = entity ? inspectGeometry(entity.mesh.geometry) : null;
      sample.base = authored ? base : null;
      sample.baseMatrix = authored ? baseMatrix.compose(base.position, quaternion.setFromEuler(base.rotation), base.scale) : null;
      sample.camera = camera;
      readRendererCounters(renderer.info, sample.counters);
      sample.counters.objects = countObjects();
      sample.counters.particles = countParticles();
      sample.counters.lights = countLights();
      onSample(sample);
    },
    dispose() {
      open = false;
      helpers.dispose();
      onSample = () => {};
    },
  };
}
