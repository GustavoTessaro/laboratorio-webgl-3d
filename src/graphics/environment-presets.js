import * as THREE from 'three';
import catalog from '../../backend/Laboratorio.Collaboration/Contracts/EnvironmentCatalog.json' with { type: 'json' };
import { describeGeometry } from './geometries.js';
import { changeLighting, DEFAULT_LIGHTING } from './lighting-settings.js';
import { normalizeMaterialSettings } from './object-materials.js';
import { changeParticles, EMPTY_PARTICLES } from './particle-settings.js';
import { BOUNDS_EPSILON, WORKSPACE_HEIGHT, WORKSPACE_LIMIT } from './scene-assets.js';
import { normalizeTrajectory, trajectoryFits } from './trajectory-settings.js';
import { materialHalfSize, shaderDisplacement } from './shader-settings.js';

export const ENVIRONMENT_VERSION = catalog.version;
export const environments = catalog.environments;
export const MAX_ENVIRONMENT_OBJECTS = 100;

function validateEntity(entity) {
  const spec = describeGeometry(entity.type, entity.geometryParameters);
  const material = normalizeMaterialSettings(entity.materialSettings);
  const halfSize = materialHalfSize(spec.halfSize, material, new THREE.Vector3());
  const { position, rotation, scale, animation } = entity;
  const axes = ['x', 'y', 'z'];
  const vector = (values) => new THREE.Vector3(...axes.map((axis) => values[axis]));
  if (![position, rotation, scale].every((values) => axes.every((axis) => Number.isFinite(values[axis]))) ||
      !axes.every((axis) => scale[axis] >= 0.2 && scale[axis] <= 3) ||
      !axes.includes(animation.axis) || typeof animation.enabled !== 'boolean' ||
      !Number.isFinite(animation.speed) || animation.speed < 0 || animation.speed > 360 ||
      !/^#[0-9a-f]{6}$/i.test(entity.color) || !['solid', 'wireframe'].includes(entity.materialMode) ||
      typeof entity.name !== 'string' || !entity.name.trim() || entity.name.length > 64) {
    throw new Error('O ambiente contém propriedades de objeto inválidas.');
  }
  const matrix = new THREE.Matrix4().compose(vector(position),
    new THREE.Quaternion().setFromEuler(new THREE.Euler(rotation.x, rotation.y, rotation.z)), vector(scale));
  const bounds = new THREE.Box3(halfSize.clone().negate(), halfSize.clone()).applyMatrix4(matrix);
  const limits = new THREE.Box3(new THREE.Vector3(-WORKSPACE_LIMIT, 0, -WORKSPACE_LIMIT),
    new THREE.Vector3(WORKSPACE_LIMIT, WORKSPACE_HEIGHT, WORKSPACE_LIMIT)).expandByScalar(BOUNDS_EPSILON);
  const trajectory = normalizeTrajectory(entity.trajectory);
  const radius = animation.enabled || trajectory?.orient ? halfSize.clone().multiply(vector(scale)).length() : null;
  const extents = bounds.getSize(new THREE.Vector3()).multiplyScalar(0.5);
  if (shaderDisplacement(material) && animation.enabled) {
    bounds.min.copy(vector(position)).addScalar(-radius);
    bounds.max.copy(vector(position)).addScalar(radius);
  }
  if (!limits.containsBox(bounds) || !trajectoryFits(trajectory, position, extents, radius)) {
    throw new Error('Um objeto ou trajetória do ambiente ultrapassa os limites da cena.');
  }
}

export function prepareEnvironment(id, mode, current, nextId = () => crypto.randomUUID()) {
  const preset = environments.find((candidate) => candidate.id === id);
  if (!preset || !['add', 'replace'].includes(mode) || (preset.replaceOnly && mode !== 'replace')) {
    throw new Error('Ambiente ou modo de aplicação indisponível.');
  }
  const replace = mode === 'replace';
  if ((replace ? 0 : current.entities.length) + preset.objects.length > MAX_ENVIRONMENT_OBJECTS) {
    throw new Error(`Limite de ${MAX_ENVIRONMENT_OBJECTS} objetos por sala.`);
  }
  const used = new Set([...current.entities.map(({ id }) => id), ...Object.keys(current.particles)]);
  function generateId() {
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const id = nextId();
      if (!used.has(id)) {
        used.add(id);
        return id;
      }
    }
    throw new Error('Não foi possível gerar identificadores únicos para o ambiente.');
  }
  const entities = preset.objects.map((object) => {
    validateEntity(object);
    return { ...object, id: generateId() };
  });
  let lighting = replace ? DEFAULT_LIGHTING : current.lighting;
  let particles = replace ? EMPTY_PARTICLES : current.particles;
  if (replace) {
    for (const [group, patch] of Object.entries(preset.lighting ?? {})) {
      lighting = changeLighting(lighting, group, patch);
    }
  }
  for (const patch of preset.particles ?? []) {
    particles = changeParticles(particles, { operation: 'add', id: generateId(), patch });
  }
  return { mode, entities, lighting, particles };
}
