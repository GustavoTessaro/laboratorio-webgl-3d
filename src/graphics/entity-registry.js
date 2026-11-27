import * as THREE from 'three';
import {
  BOUNDS_EPSILON, WORKSPACE_HEIGHT, WORKSPACE_LIMIT, WORKSPACE_SIZE,
} from './scene-assets.js';
import {
  createMaterialController, createTexturePool, normalizeMaterialSettings, sameMaterialSettings, SOLID_MATERIAL,
} from './object-materials.js';
import { createGeometry, describeGeometry, geometries, sameGeometryParameters } from './geometries.js';

const INITIAL_ROTATION_SPEED = 45;
const INITIAL_ROTATION_AXIS = 'y';
const MIN_OBJECT_SCALE = 0.2;
const MAX_OBJECT_SCALE = 3;
const spawnCoordinates = [-3.5, -1.75, 0, 1.75, 3.5]
  .flatMap((z) => [-3.5, -1.75, 0, 1.75, 3.5].map((x) => ({ x, z })))
  .filter(({ x, z }) => x !== 0 || z !== 0);

export function createEntityRegistry(scene, texturePool = createTexturePool()) {
  const entities = new Map();
  const nameCounters = new Map();
  const entityBounds = new THREE.Box3();
  const entitySize = new THREE.Vector3();
  const positionCorrection = new THREE.Vector3();
  const minimumScale = new THREE.Vector3(
    MIN_OBJECT_SCALE,
    MIN_OBJECT_SCALE,
    MIN_OBJECT_SCALE,
  );
  const previousScale = new THREE.Vector3();
  const candidateScale = new THREE.Vector3();
  const interpolatedScale = new THREE.Vector3();
  const baseMatrix = new THREE.Matrix4();
  const baseQuaternion = new THREE.Quaternion();
  const validTransforms = new Map();
  let selectedEntityId = null;
  let nextSpawnIndex = 0;
  let onSelectionChange = () => {};
  let onEntityCreated = () => {};
  let onEntityDeleted = () => {};
  let onEntityChanged = () => {};
  let copiedProperties = null;

  function serializeEntity(entity, transform = validTransforms.get(entity.id)) {
    return {
      id: entity.id,
      name: entity.name,
      type: entity.type,
      geometryParameters: entity.geometrySpec.overrides ? { ...entity.geometrySpec.overrides } : null,
      color: entity.color,
      materialMode: entity.materialMode,
      materialSettings: sameMaterialSettings(entity.materialSettings, null) ? null : { ...entity.materialSettings },
      position: { x: transform.position.x, y: transform.position.y, z: transform.position.z },
      rotation: { x: transform.rotation.x, y: transform.rotation.y, z: transform.rotation.z },
      scale: { x: transform.scale.x, y: transform.scale.y, z: transform.scale.z },
      animation: { ...entity.animation },
      lastEditor: entity.lastEditor ?? null,
    };
  }

  function measureBounds(halfSize, matrix) {
    // The server validates the transformed box built from these same half sizes.
    entityBounds.min.copy(halfSize).negate();
    entityBounds.max.copy(halfSize);
    entityBounds.applyMatrix4(matrix);
  }

  function restoreBase(entity) {
    const base = validTransforms.get(entity.id);
    if (!base) return;
    entity.mesh.position.copy(base.position);
    entity.mesh.rotation.copy(base.rotation);
    entity.mesh.scale.copy(base.scale);
  }

  function constrainEntity(entity, remember = true, halfSize = entity.geometrySpec.halfSize) {
    const { mesh } = entity;
    mesh.updateWorldMatrix(true, false);
    measureBounds(halfSize, mesh.matrixWorld);
    if (!getPositionCorrection()) {
      restoreBase(entity);
      return false;
    }
    mesh.position.add(positionCorrection);
    if (remember) {
      validTransforms.set(entity.id, {
        position: mesh.position.clone(),
        rotation: mesh.rotation.clone(),
        scale: mesh.scale.clone(),
      });
      entity.rotationPhase = 0;
    }
    return true;
  }

  function getPositionCorrection() {
    if (entityBounds.isEmpty()) return;

    if (
      !Number.isFinite(entityBounds.min.x) ||
      !Number.isFinite(entityBounds.min.y) ||
      !Number.isFinite(entityBounds.min.z) ||
      !Number.isFinite(entityBounds.max.x) ||
      !Number.isFinite(entityBounds.max.y) ||
      !Number.isFinite(entityBounds.max.z)
    ) {
      return;
    }

    entityBounds.getSize(entitySize);
    if (
      entitySize.x > WORKSPACE_SIZE + BOUNDS_EPSILON ||
      entitySize.y > WORKSPACE_HEIGHT + BOUNDS_EPSILON ||
      entitySize.z > WORKSPACE_SIZE + BOUNDS_EPSILON
    ) {
      return false;
    }

    positionCorrection.set(0, 0, 0);

    if (entityBounds.min.x < -WORKSPACE_LIMIT) {
      positionCorrection.x = -WORKSPACE_LIMIT - entityBounds.min.x;
    } else if (entityBounds.max.x > WORKSPACE_LIMIT) {
      positionCorrection.x = WORKSPACE_LIMIT - entityBounds.max.x;
    }

    if (entityBounds.min.y < 0) {
      positionCorrection.y = -entityBounds.min.y;
    } else if (entityBounds.max.y > WORKSPACE_HEIGHT) {
      positionCorrection.y = WORKSPACE_HEIGHT - entityBounds.max.y;
    }

    if (entityBounds.min.z < -WORKSPACE_LIMIT) {
      positionCorrection.z = -WORKSPACE_LIMIT - entityBounds.min.z;
    } else if (entityBounds.max.z > WORKSPACE_LIMIT) {
      positionCorrection.z = WORKSPACE_LIMIT - entityBounds.max.z;
    }

    return true;
  }

  function scaleFitsWorkspace(entity) {
    entity.mesh.updateWorldMatrix(true, false);
    measureBounds(entity.geometrySpec.halfSize, entity.mesh.matrixWorld);
    if (entityBounds.isEmpty()) return false;
    entityBounds.getSize(entitySize);
    return (
      entitySize.x <= WORKSPACE_SIZE + BOUNDS_EPSILON &&
      entitySize.y <= WORKSPACE_HEIGHT + BOUNDS_EPSILON &&
      entitySize.z <= WORKSPACE_SIZE + BOUNDS_EPSILON
    );
  }

  function constrainEntityScale(entity, remember = true) {
    const { mesh } = entity;
    const stableScale = validTransforms.get(entity.id)?.scale ?? minimumScale;

    previousScale.copy(stableScale);
    candidateScale.set(
      Number.isFinite(mesh.scale.x)
        ? THREE.MathUtils.clamp(mesh.scale.x, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
        : previousScale.x,
      Number.isFinite(mesh.scale.y)
        ? THREE.MathUtils.clamp(mesh.scale.y, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
        : previousScale.y,
      Number.isFinite(mesh.scale.z)
        ? THREE.MathUtils.clamp(mesh.scale.z, MIN_OBJECT_SCALE, MAX_OBJECT_SCALE)
        : previousScale.z,
    );
    mesh.scale.copy(candidateScale);
    let baselineScale = previousScale;
    if (!scaleFitsWorkspace(entity)) {
      mesh.scale.copy(minimumScale);
      if (!scaleFitsWorkspace(entity)) {
        mesh.scale.copy(previousScale);
        constrainEntity(entity, remember);
        return false;
      }
      baselineScale = minimumScale;
    }
    previousScale.copy(baselineScale);
    mesh.scale.copy(candidateScale);

    if (!scaleFitsWorkspace(entity)) {
      let minimum = 0;
      let maximum = 1;
      for (let iteration = 0; iteration < 24; iteration += 1) {
        const factor = (minimum + maximum) / 2;
        interpolatedScale.lerpVectors(previousScale, candidateScale, factor);
        mesh.scale.copy(interpolatedScale);
        if (scaleFitsWorkspace(entity)) {
          minimum = factor;
        } else {
          maximum = factor;
        }
      }
      mesh.scale.copy(interpolatedScale.lerpVectors(previousScale, candidateScale, minimum));
    }

    if (!constrainEntity(entity, remember)) {
      mesh.scale.copy(previousScale);
      constrainEntity(entity, remember);
    }
    return true;
  }

  function setSelectionChangeHandler(handler) {
    onSelectionChange = handler;
    onSelectionChange(getSelectedEntity());
  }

  function nextEntityName(type) {
    const number = (nameCounters.get(type) ?? 0) + 1;
    nameCounters.set(type, number);
    return `${geometries[type].name} ${number}`;
  }

  function createEntity(type = 'box', position = null) {
    const geometrySpec = describeGeometry(type, position?.geometryParameters);

    const spawn = position ?? spawnCoordinates[nextSpawnIndex % spawnCoordinates.length];
    if (!position) nextSpawnIndex += 1;
    const id = position?.id ?? crypto.randomUUID();
    if (entities.has(id)) throw new Error(`Já existe um objeto com o identificador ${id}.`);
    const geometry = createGeometry(geometrySpec);
    const mesh = new THREE.Mesh(geometry, null);
    mesh.position.set(spawn.x, spawn.y ?? geometrySpec.halfSize.y, spawn.z);
    const requestedScale = position?.scale?.clone() ?? mesh.scale.clone();
    if (position?.rotation) mesh.rotation.copy(position.rotation);
    mesh.scale.copy(minimumScale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = {
      id,
      name: position?.name ?? nextEntityName(type),
      type,
      geometrySpec,
      mesh,
      color: position?.color ?? SOLID_MATERIAL.color,
      materialMode: position?.materialMode ?? 'solid',
      rotationPhase: 0,
      animation: position?.animation ? { ...position.animation } : {
        enabled: false,
        axis: INITIAL_ROTATION_AXIS,
        speed: INITIAL_ROTATION_SPEED,
      },
      lastEditor: position?.lastEditor ?? null,
    };
    entity.materialController = createMaterialController(mesh, texturePool);
    applyAppearance(entity, entity.color, entity.materialMode, position?.materialSettings);

    entities.set(id, entity);
    mesh.userData.entityId = id;
    scene.add(mesh);
    constrainEntity(entity);
    mesh.scale.copy(requestedScale);
    constrainEntityScale(entity);
    selectedEntityId = id;
    onSelectionChange(entity);
    onEntityCreated(serializeEntity(entity));
    return entity;
  }

  function getDuplicatePosition(entity) {
    const base = validTransforms.get(entity.id);
    baseMatrix.compose(base.position, baseQuaternion.setFromEuler(base.rotation), base.scale);
    measureBounds(entity.geometrySpec.halfSize, baseMatrix);
    if (
      entityBounds.isEmpty() ||
      !Number.isFinite(entityBounds.min.x) ||
      !Number.isFinite(entityBounds.min.y) ||
      !Number.isFinite(entityBounds.min.z) ||
      !Number.isFinite(entityBounds.max.x) ||
      !Number.isFinite(entityBounds.max.y) ||
      !Number.isFinite(entityBounds.max.z) ||
      entityBounds.min.y < -BOUNDS_EPSILON
    ) {
      return null;
    }

    const offsets = [
      [1.5, 0],
      [-1.5, 0],
      [0, 1.5],
      [0, -1.5],
      [0, 0],
    ];
    for (const [offsetX, offsetZ] of offsets) {
      if (
        entityBounds.min.x + offsetX >= -WORKSPACE_LIMIT &&
        entityBounds.max.x + offsetX <= WORKSPACE_LIMIT &&
        entityBounds.min.z + offsetZ >= -WORKSPACE_LIMIT &&
        entityBounds.max.z + offsetZ <= WORKSPACE_LIMIT
      ) {
        return {
          x: base.position.x + offsetX,
          y: base.position.y,
          z: base.position.z + offsetZ,
        };
      }
    }
    return null;
  }

  function duplicateEntity(id) {
    const source = getEntity(id);
    if (!source) return null;
    const position = getDuplicatePosition(source);
    if (!position) return null;
    const base = validTransforms.get(id);

    return createEntity(source.type, {
      ...position,
      scale: base.scale,
      rotation: base.rotation,
      geometryParameters: source.geometrySpec.overrides,
      color: source.color,
      materialMode: source.materialMode,
      materialSettings: source.materialSettings,
      animation: { ...source.animation },
    });
  }

  function copyEntityProperties(id) {
    const entity = getEntity(id);
    if (!entity) return false;

    copiedProperties = {
      color: entity.color,
      materialMode: entity.materialMode,
      materialSettings: { ...entity.materialSettings },
      scale: validTransforms.get(id).scale.clone(),
      animation: { ...entity.animation },
    };
    return true;
  }

  function applyCopiedProperties(id) {
    const entity = getEntity(id);
    if (!entity || !copiedProperties) return false;

    restoreBase(entity);
    applyAppearance(entity, copiedProperties.color, copiedProperties.materialMode, copiedProperties.materialSettings);
    entity.mesh.scale.set(
      copiedProperties.scale.x,
      copiedProperties.scale.y,
      copiedProperties.scale.z,
    );
    entity.animation = { ...copiedProperties.animation };
    constrainEntityScale(entity);
    onSelectionChange(entity);
    onEntityChanged(serializeEntity(entity));
    return true;
  }

  function hasCopiedProperties() {
    return copiedProperties !== null;
  }

  function getEntity(id) {
    return entities.get(id) ?? null;
  }

  function getEntities() {
    return Array.from(entities.values());
  }

  function getSelectedEntity() {
    return getEntity(selectedEntityId);
  }

  function selectEntity(id) {
    if (!entities.has(id)) {
      throw new Error(`Objeto desconhecido: ${id}`);
    }
    selectedEntityId = id;
    const entity = entities.get(id);
    onSelectionChange(entity);
    return entity;
  }

  function getSelectedEntityOrThrow() {
    const entity = getSelectedEntity();
    if (!entity) {
      throw new Error('Não há objeto selecionado.');
    }
    return entity;
  }

  function releaseMesh({ mesh, materialController }) {
    scene.remove(mesh);
    mesh.geometry.dispose();
    materialController.dispose();
  }

  function removeEntity(id) {
    const entity = entities.get(id);
    if (!entity) return false;

    cancelGeometryPreview(entity);
    releaseMesh(entity);
    entities.delete(id);
    validTransforms.delete(id);
    onEntityDeleted(id);

    if (selectedEntityId === id) {
      selectedEntityId = entities.keys().next().value ?? null;
      onSelectionChange(getSelectedEntity());
    }
    return true;
  }

  function cancelGeometryPreview(entity) {
    const preview = entity.geometryPreview;
    if (!preview) return;
    entity.mesh.geometry.dispose();
    entity.mesh.geometry = preview.original;
    entity.geometryPreview = null;
    applyVisualPose(entity);
  }

  function setGeometry(entity, type, parameters, previewOnly = false) {
    if (entity.editingTransform) throw new Error('Conclua a transformação antes de editar a geometria.');
    const spec = describeGeometry(type, parameters);
    const committed = entity.geometrySpec;
    if (committed.type === type && sameGeometryParameters(committed.overrides, spec.overrides)) {
      cancelGeometryPreview(entity);
      return false;
    }

    const base = validTransforms.get(entity.id);
    baseMatrix.compose(base.position, baseQuaternion.setFromEuler(base.rotation), base.scale);
    measureBounds(spec.halfSize, baseMatrix);
    if (!getPositionCorrection()) {
      throw new Error('A geometria não cabe na cena com a escala e a rotação atuais.');
    }

    const preview = entity.geometryPreview;
    const matchesPreview = preview?.spec.type === type &&
      sameGeometryParameters(preview.spec.overrides, spec.overrides);
    if (!matchesPreview) {
      const geometry = createGeometry(spec);
      const original = preview?.original ?? entity.mesh.geometry;
      if (preview) entity.mesh.geometry.dispose();
      entity.mesh.geometry = geometry;
      entity.geometryPreview = { original, spec };
    }
    if (previewOnly) {
      applyVisualPose(entity);
      return true;
    }
    entity.geometryPreview.original.dispose();
    entity.geometryPreview = null;
    if (entity.type !== type) entity.name = nextEntityName(type);
    entity.type = type;
    entity.geometrySpec = spec;
    base.position.add(positionCorrection);
    applyVisualPose(entity);
    if (entity.id === selectedEntityId) onSelectionChange(entity);
    onEntityChanged(serializeEntity(entity));
    return true;
  }

  function replaceGeometry(entity, type) {
    if (type !== entity.type) return setGeometry(entity, type, null);
    return false;
  }

  function applyVisualPose(entity) {
    const halfSize = (entity.geometryPreview?.spec ?? entity.geometrySpec).halfSize;
    restoreBase(entity);
    if (entity.animation.enabled) {
      entity.mesh.rotation[entity.animation.axis] += entity.rotationPhase;
    }
    if (!constrainEntity(entity, false, halfSize) && entity.geometryPreview) {
      // The authored pose fits even if the current animated angle does not.
      constrainEntity(entity, false, halfSize);
    }
  }

  function updateAnimations(delta) {
    for (const entity of entities.values()) {
      if (!entity.animation.enabled || entity.editingTransform) continue;
      const speed = entity.previewRotationSpeed ?? entity.animation.speed;
      entity.rotationPhase = (entity.rotationPhase + THREE.MathUtils.degToRad(speed) * delta)
        % (2 * Math.PI);
      applyVisualPose(entity);
    }
  }

  function applyAppearance(entity, color, materialMode, input) {
    const settings = normalizeMaterialSettings(input);
    entity.materialController.apply(color, materialMode, settings);
    const changed = color !== entity.color || materialMode !== entity.materialMode ||
      !sameMaterialSettings(settings, entity.materialSettings);
    entity.color = color;
    entity.materialMode = materialMode;
    entity.materialSettings = settings;
    return changed;
  }

  function setAppearance(entity, color, materialMode = entity.materialMode, settings = entity.materialSettings) {
    if (!applyAppearance(entity, color, materialMode, settings)) return false;
    onEntityChanged(serializeEntity(entity));
    return true;
  }

  function setMaterialSettings(entity, settings, preview = false) {
    if (preview) {
      entity.materialController.apply(entity.color, entity.materialMode, normalizeMaterialSettings(settings));
    } else {
      setAppearance(entity, entity.color, entity.materialMode, settings);
    }
  }

  function setAnimation(entity, changes) {
    const animation = { ...entity.animation, ...changes };
    if (Object.keys(changes).every((key) => animation[key] === entity.animation[key])) return;
    if (animation.enabled !== entity.animation.enabled || animation.axis !== entity.animation.axis) {
      entity.rotationPhase = 0;
      restoreBase(entity);
    }
    entity.animation = animation;
    onEntityChanged(serializeEntity(entity));
  }

  function setMutationHandlers(handlers = {}) {
    onEntityCreated = handlers.onCreated ?? (() => {});
    onEntityDeleted = handlers.onDeleted ?? (() => {});
    onEntityChanged = handlers.onChanged ?? (() => {});
  }

  function clearEntities() {
    for (const entity of entities.values()) {
      cancelGeometryPreview(entity);
      releaseMesh(entity);
    }
    entities.clear();
    validTransforms.clear();
    selectedEntityId = null;
  }

  function replaceEntities(snapshots) {
    clearEntities();
    for (const snapshot of snapshots) {
      createEntity(snapshot.type, {
        id: snapshot.id,
        name: snapshot.name,
        x: snapshot.position.x,
        y: snapshot.position.y,
        z: snapshot.position.z,
        scale: new THREE.Vector3(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z),
        rotation: new THREE.Euler(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z),
        color: snapshot.color,
        materialMode: snapshot.materialMode,
        materialSettings: snapshot.materialSettings,
        animation: snapshot.animation,
        geometryParameters: snapshot.geometryParameters,
      });
      const entity = getEntity(snapshot.id);
      entity.lastEditor = snapshot.lastEditor ?? null;
    }
    selectedEntityId = entities.keys().next().value ?? null;
    onSelectionChange(getSelectedEntity());
  }

  function applyEntitySnapshot(snapshot) {
    let entity = getEntity(snapshot.id);
    if (!entity) {
      createEntity(snapshot.type, {
        id: snapshot.id,
        name: snapshot.name,
        x: snapshot.position.x,
        y: snapshot.position.y,
        z: snapshot.position.z,
        scale: new THREE.Vector3(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z),
        rotation: new THREE.Euler(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z),
        color: snapshot.color,
        materialMode: snapshot.materialMode,
        materialSettings: snapshot.materialSettings,
        animation: snapshot.animation,
        geometryParameters: snapshot.geometryParameters,
        lastEditor: snapshot.lastEditor,
      });
      entity = getEntity(snapshot.id);
    } else {
      const base = validTransforms.get(entity.id);
      cancelGeometryPreview(entity);
      const typeChanged = entity.type !== snapshot.type;
      const spec = describeGeometry(snapshot.type, snapshot.geometryParameters);
      const geometryChanged = typeChanged ||
        !sameGeometryParameters(entity.geometrySpec.overrides, spec.overrides);
      const transformChanged = ['position', 'rotation', 'scale'].some((key) =>
        ['x', 'y', 'z'].some((axis) => base[key][axis] !== snapshot[key][axis]),
      );
      const restart = transformChanged ||
        entity.animation.enabled !== snapshot.animation.enabled ||
        entity.animation.axis !== snapshot.animation.axis;
      if (geometryChanged) {
        const geometry = createGeometry(spec);
        entity.mesh.geometry.dispose();
        entity.mesh.geometry = geometry;
        entity.geometrySpec = spec;
      }
      entity.type = snapshot.type;
      entity.name = snapshot.name;
      applyAppearance(entity, snapshot.color, snapshot.materialMode, snapshot.materialSettings);
      entity.animation = { ...snapshot.animation };
      entity.lastEditor = snapshot.lastEditor ?? null;
      if (restart) {
        entity.mesh.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
        entity.mesh.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
        entity.mesh.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
        constrainEntity(entity);
      } else if (geometryChanged) {
        applyVisualPose(entity);
      }
    }
    return entity;
  }

  function removeRemoteEntity(id) {
    const entity = entities.get(id);
    if (!entity) return false;
    const previousCreated = onEntityCreated;
    const previousDeleted = onEntityDeleted;
    onEntityCreated = () => {};
    onEntityDeleted = () => {};
    try {
      return removeEntity(id);
    } finally {
      onEntityCreated = previousCreated;
      onEntityDeleted = previousDeleted;
    }
  }

  function getSharedEntities() {
    return Array.from(entities.values(), (entity) => serializeEntity(entity));
  }

  return {
    createEntity,
    duplicateEntity,
    copyEntityProperties,
    applyCopiedProperties,
    hasCopiedProperties,
    setSelectionChangeHandler,
    getEntity,
    getEntities,
    count: () => entities.size,
    readBaseTransform(id, target) {
      const transform = validTransforms.get(id);
      if (!transform) return false;
      target.position.copy(transform.position);
      target.rotation.copy(transform.rotation);
      target.scale.copy(transform.scale);
      return true;
    },
    getSelectedEntity,
    getSelectedEntityOrThrow,
    selectEntity,
    removeEntity,
    replaceGeometry,
    setGeometry,
    cancelGeometryPreview,
    constrainEntity,
    constrainEntityScale,
    restoreBase,
    updateAnimations,
    setAppearance,
    setMaterialSettings,
    setAnimation,
    setMutationHandlers,
    serializeEntity: (id, pose) => {
      const entity = getEntity(id);
      return entity ? serializeEntity(entity, pose) : null;
    },
    replaceEntities,
    dispose() {
      setMutationHandlers();
      onSelectionChange = () => {};
      clearEntities();
      copiedProperties = null;
      nameCounters.clear();
    },
    applyEntitySnapshot,
    removeRemoteEntity,
    getSharedEntities,
  };
}

