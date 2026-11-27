import * as THREE from 'three';
import { PARTICLE_BUDGET } from './particle-settings.js';

const MAX_DELTA = 0.05;
const TAU = Math.PI * 2;
const CAPACITY = PARTICLE_BUDGET.perEffect;
const SEED_FIELDS = 5;
const MOTION_FIELDS = ['type', 'seed', 'count', 'speed', 'area', 'dispersion', 'gravity', 'wind', 'life', 'radius', 'arms'];

function makePointTexture() {
  const edge = 32;
  const pixels = new Uint8Array(edge * edge * 4);
  for (let y = 0; y < edge; y += 1) {
    for (let x = 0; x < edge; x += 1) {
      const i = (y * edge + x) * 4;
      pixels[i] = pixels[i + 1] = pixels[i + 2] = 255;
      const radius = Math.hypot((x + 0.5) / edge * 2 - 1, (y + 0.5) / edge * 2 - 1);
      pixels[i + 3] = Math.round(255 * THREE.MathUtils.clamp((1 - radius) * 3, 0, 1));
    }
  }
  const texture = new THREE.DataTexture(pixels, edge, edge);
  texture.magFilter = texture.minFilter = THREE.LinearFilter;
  texture.needsUpdate = true;
  return texture;
}

function fillSeed(buffer, seed) {
  let state = seed;
  for (let i = 0; i < buffer.length; i += 1) {
    state = (Math.imul(state, 1664525) + 1013904223) >>> 0;
    buffer[i] = (state >>> 8) / 16777216;
  }
}

function wrap(value, area) {
  return value - area * Math.floor(value / area + 0.5);
}

function writePositions(emitter) {
  const { config, elapsed, random, position } = emitter;
  const coordinates = position.array;
  const { type, count, area, speed, dispersion, gravity, wind, life, radius, arms } = config;
  for (let n = 0, i = 0, j = 0; n < count; n += 1, i += 3, j += SEED_FIELDS) {
    const a = random[j], b = random[j + 1], c = random[j + 2], d = random[j + 3], e = random[j + 4];
    if (type === 'fountain') {
      const direction = a * TAU;
      const upward = speed * (0.7 + b * 0.6);
      const spread = speed * dispersion * (0.15 + c * 0.85);
      const duration = Math.min(life, gravity > 0 ? 2 * upward / gravity : life);
      const age = (elapsed + d * duration) % duration;
      const offset = (e - 0.5) * area + spread * age;
      coordinates[i] = Math.cos(direction) * offset;
      coordinates[i + 1] = Math.max(0, upward * age - gravity * age * age / 2);
      coordinates[i + 2] = Math.sin(direction) * offset;
    } else if (type === 'galaxy') {
      const distance = radius * Math.sqrt(a);
      const arm = Math.floor(b * arms) * TAU / arms;
      const angle = arm + 3 * distance / radius + (c - 0.5) * dispersion * 2 + elapsed * speed * 0.35;
      coordinates[i] = Math.cos(angle) * distance;
      coordinates[i + 1] = (d - 0.5) * dispersion * radius * (1 - a * 0.7);
      coordinates[i + 2] = Math.sin(angle) * distance;
    } else {
      const fall = speed * (0.65 + c * 0.7);
      const duration = Math.min(life, Math.max(0.5, config.y) / fall);
      const age = (elapsed + d * duration) % duration;
      const drift = type === 'snow' ? Math.sin(age * (1 + e) + b * TAU) * dispersion : 0;
      coordinates[i] = wrap((a - 0.5) * area + wind * age + drift, area);
      coordinates[i + 1] = -fall * age;
      coordinates[i + 2] = wrap((b - 0.5) * area + drift * (e - 0.5), area);
    }
  }
  emitter.upload.count = count * 3;
  position.updateRanges[0] = emitter.upload;
  position.needsUpdate = true;
}

export function createParticleSystem(scene, pointSizeLimit = 64, pixelRatio = 1) {
  const emitters = new Map();
  let map;

  function add(id) {
    map ??= makePointTexture();
    const geometry = new THREE.BufferGeometry();
    const position = new THREE.BufferAttribute(new Float32Array(CAPACITY * 3), 3)
      .setUsage(THREE.DynamicDrawUsage);
    geometry.setAttribute('position', position);
    const material = new THREE.PointsMaterial({
      map, transparent: true, depthTest: true, depthWrite: false, sizeAttenuation: false, alphaTest: 0.02,
    });
    const points = new THREE.Points(geometry, material);
    // A particle can leave the emitter's initial bounds during playback.
    points.frustumCulled = false;
    points.name = `Partículas ${id}`;
    scene.add(points);
    const emitter = { points, position, upload: { start: 0, count: 0 },
      random: new Float32Array(CAPACITY * SEED_FIELDS), config: null, elapsed: 0, playing: true };
    emitters.set(id, emitter);
    return emitter;
  }

  function remove(id) {
    const { points } = emitters.get(id);
    points.removeFromParent();
    points.geometry.dispose();
    points.material.dispose();
    emitters.delete(id);
  }

  function apply(effects) {
    for (const id of emitters.keys()) if (!Object.hasOwn(effects, id)) remove(id);
    for (const [id, config] of Object.entries(effects)) {
      const emitter = emitters.get(id) ?? add(id);
      const previous = emitter.config;
      if (previous && Object.keys(config).every((key) => config[key] === previous[key])) continue;
      emitter.config = config;
      if (!previous || previous.seed !== config.seed) fillSeed(emitter.random, config.seed);
      if (previous?.type !== config.type || previous?.seed !== config.seed) emitter.elapsed = 0;
      const { points } = emitter;
      points.position.set(config.x, config.y, config.z);
      points.visible = config.enabled;
      points.geometry.setDrawRange(0, config.count);
      points.material.color.set(config.color);
      points.material.opacity = config.opacity;
      points.material.size = Math.min(config.size, pointSizeLimit / pixelRatio);
      points.material.blending = config.type === 'galaxy' ? THREE.AdditiveBlending : THREE.NormalBlending;
      const falling = config.type === 'rain' || config.type === 'snow';
      if (!previous || (falling && previous.y !== config.y) ||
          MOTION_FIELDS.some((key) => previous[key] !== config[key])) writePositions(emitter);
    }
    if (!emitters.size && map) {
      map.dispose();
      map = null;
    }
  }

  return {
    apply,
    update(dt) {
      const delta = Math.min(MAX_DELTA, Number.isFinite(dt) ? dt : 0);
      if (delta <= 0) return;
      for (const emitter of emitters.values()) {
        if (!emitter.playing || !emitter.config.enabled) continue;
        emitter.elapsed += delta;
        writePositions(emitter);
      }
    },
    setPlaying(id, playing) {
      const emitter = emitters.get(id);
      if (emitter) emitter.playing = playing;
    },
    isPlaying(id) { return emitters.get(id)?.playing ?? false; },
    restart(id) {
      const emitter = emitters.get(id);
      if (!emitter) return;
      emitter.elapsed = 0;
      writePositions(emitter);
    },
    dispose() { apply({}); },
  };
}
