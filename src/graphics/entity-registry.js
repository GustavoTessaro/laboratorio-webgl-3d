import * as THREE from 'three';
import {
  BOUNDS_EPSILON, WORKSPACE_HEIGHT, WORKSPACE_LIMIT, WORKSPACE_SIZE,
} from './scene-assets.js';
import {
  createMaterialController, createTexturePool, normalizeMaterialSettings, sameMaterialSettings, SOLID_MATERIAL,
} from './object-materials.js';
import { createGeometry, describeGeometry, geometries, sameGeometryParameters } from './geometries.js';
import { normalizeTrajectory, sameTrajectory, trajectoryFits } from './trajectory-settings.js';
import { advanceTrajectory, createTrajectoryMotion, createTrajectoryPose } from './trajectory-motion.js';
import { materialHalfSize, shaderDisplacement } from './shader-settings.js';
import { isCatalogModel, modelCatalog, PRIVATE_MODEL, validateModelBudget } from './model-settings.js';

const INITIAL_ROTATION_SPEED = 45;
const INITIAL_ROTATION_AXIS = 'y';
const MIN_OBJECT_SCALE = 0.2;
const MAX_OBJECT_SCALE = 3;
const spawnCoordinates = [-3.5, -1.75, 0, 1.75, 3.5]
  .flatMap((z) => [-3.5, -1.75, 0, 1.75, 3.5].map((x) => ({ x, z })))
  .filter(({ x, z }) => x !== 0 || z !== 0);

export function createEntityRegistry(scene, texturePool = createTexturePool(), failedShaders, models) {
  const entities = new Map();
  const parkedModels = new Map();
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
  const trajectoryExtents = new THREE.Vector3();
  const scaledHalfSize = new THREE.Vector3();
  const deformedHalfSize = new THREE.Vector3();
  const workspace = new THREE.Box3(new THREE.Vector3(-WORKSPACE_LIMIT, 0, -WORKSPACE_LIMIT),
    new THREE.Vector3(WORKSPACE_LIMIT, WORKSPACE_HEIGHT, WORKSPACE_LIMIT)).expandByScalar(BOUNDS_EPSILON);
  const applyTrajectoryPose = createTrajectoryPose();
  const validTransforms = new Map();
  let selectedEntityId = null;
  let nextSpawnIndex = 0;
  let onSelectionChange = () => {};
  let onEntityCreated = () => {};
  let onEntityDeleted = () => {};
  let onEntityChanged = () => {};
  let copiedProperties = null;
  let privateVisible = true;

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
      trajectory: entity.trajectory,
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

  function fitsTrajectory(settings, pose, halfSize, animation, position = pose.position) {
    if (!settings?.enabled) return true;
    scaledHalfSize.copy(halfSize).multiply(pose.scale);
    const radius = animation.enabled || settings.orient ? scaledHalfSize.length() : null;
    baseMatrix.compose(position, baseQuaternion.setFromEuler(pose.rotation), pose.scale);
    measureBounds(halfSize, baseMatrix);
    entityBounds.getSize(trajectoryExtents).multiplyScalar(0.5);
    return trajectoryFits(settings, position, trajectoryExtents, radius);
  }

  function requireTrajectoryFit(settings, pose, halfSize, animation, position) {
    if (!fitsTrajectory(settings, pose, halfSize, animation, position)) {
      throw new Error('A trajetória completa, incluindo as dimensões do objeto, ultrapassa os limites da cena.');
    }
  }

  function effectiveSettings(entity) {
    return shaderDisplacement(entity.previewMaterialSettings) > shaderDisplacement(entity.materialSettings)
      ? entity.previewMaterialSettings : entity.materialSettings;
  }

  function halfSizeFor(entity, spec = entity.geometrySpec) {
    return materialHalfSize(spec.halfSize, effectiveSettings(entity), deformedHalfSize);
  }

  function baseEnvelopeFits(halfSize, pose, animation) {
    if (animation.enabled) {
      const radius = scaledHalfSize.copy(halfSize).multiply(pose.scale).length();
      entityBounds.min.copy(pose.position).addScalar(-radius);
      entityBounds.max.copy(pose.position).addScalar(radius);
    } else {
      baseMatrix.compose(pose.position, baseQuaternion.setFromEuler(pose.rotation), pose.scale);
      measureBounds(halfSize, baseMatrix);
    }
    return workspace.containsBox(entityBounds);
  }

  function ensureShaderFit(entity, settings) {
    if (!shaderDisplacement(settings)) return;
    const base = validTransforms.get(entity.id);
    for (const spec of [entity.geometrySpec, entity.geometryPreview?.spec]) {
      if (!spec) continue;
      const halfSize = materialHalfSize(spec.halfSize, settings, deformedHalfSize);
      if (!baseEnvelopeFits(halfSize, base, entity.animation) ||
          !fitsTrajectory(entity.trajectory, base, halfSize, entity.animation) ||
          !fitsTrajectory(entity.trajectoryPreview?.settings, base, halfSize, entity.animation)) {
        throw new Error('A ondulação, incluindo toda a rotação ou trajetória, ultrapassa os limites da cena. Eleve o objeto ou reduza a amplitude ou a escala.');
      }
    }
  }

  function setTrajectory(entity, input, preview = false) {
    if (entity.editingTransform) return false;
    const settings = normalizeTrajectory(input);
    const base = validTransforms.get(entity.id);
    requireTrajectoryFit(settings, base, halfSizeFor(entity), entity.animation);
    if (entity.geometryPreview) {
      requireTrajectoryFit(settings, base, halfSizeFor(entity, entity.geometryPreview.spec), entity.animation);
    }
    if (preview) {
      entity.trajectoryPreview = settings?.enabled ? createTrajectoryMotion(settings) : null;
      applyVisualPose(entity);
      return true;
    }
    cancelTrajectoryPreview(entity);
    if (sameTrajectory(settings, entity.trajectory)) return false;
    const before = serializeEntity(entity);
    if (entity.trajectory?.enabled && !settings?.enabled) entity.rotationPhase = 0;
    entity.trajectory = settings;
    entity.trajectoryMotion = settings?.enabled ? createTrajectoryMotion(settings) : null;
    applyVisualPose(entity);
    onEntityChanged(serializeEntity(entity), before);
    return true;
  }

  function cancelTrajectoryPreview(entity) {
    if (entity.trajectoryPreview === undefined) return;
    entity.trajectoryPreview = undefined;
    if (!entity.editingTransform) applyVisualPose(entity);
  }

  function constrainEntity(entity, remember = true, halfSize = halfSizeFor(entity)) {
    const { mesh } = entity;
    mesh.updateWorldMatrix(true, false);
    measureBounds(halfSize, mesh.matrixWorld);
    if (!getPositionCorrection()) {
      restoreBase(entity);
      return false;
    }
    const displacement = shaderDisplacement(effectiveSettings(entity));
    if ((entity.trajectory?.enabled || displacement) && positionCorrection.lengthSq() > BOUNDS_EPSILON ** 2) {
      restoreBase(entity);
      return false;
    }
    mesh.position.add(positionCorrection);
    if (((displacement || entity.model) && !baseEnvelopeFits(halfSize, mesh, entity.animation)) ||
        !fitsTrajectory(entity.trajectory, mesh, halfSize, entity.animation)) {
      restoreBase(entity);
      return false;
    }
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
    measureBounds(halfSizeFor(entity), entity.mesh.matrixWorld);
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
      if (entity.trajectory?.enabled || entity.model || shaderDisplacement(effectiveSettings(entity))) return false;
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
    const privateModel = type === PRIVATE_MODEL;
    const catalogModel = isCatalogModel(type);
    if (privateModel && !privateVisible) throw new Error('Arquivos particulares estão disponíveis somente no modo local.');
    const asset = privateModel ? position?.modelAsset : catalogModel ? models?.get(type) : null;
    if ((privateModel || catalogModel) && !asset) throw new Error('O modelo 3D ainda não está disponível.');
    if (asset) {
      if (entities.size >= 100) throw new Error('Limite de 100 objetos por cena.');
      validateModelBudget([...getEntities().filter((entity) => entity.model).map((entity) => entity.model.info), asset.info]);
    }
    const geometrySpec = asset ? { halfSize: catalogModel ? new THREE.Vector3(...modelCatalog[type].halfSize)
      : asset.halfSize, overrides: null } : describeGeometry(type, position?.geometryParameters);

    const useSpawn = position?.x === undefined;
    const spawn = useSpawn ? spawnCoordinates[nextSpawnIndex % spawnCoordinates.length] : position;
    if (useSpawn) nextSpawnIndex += 1;
    const id = position?.id ?? crypto.randomUUID();
    if (entities.has(id)) throw new Error(`Já existe um objeto com o identificador ${id}.`);
    const mesh = asset ? asset.instantiate() : new THREE.Mesh(createGeometry(geometrySpec), null);
    mesh.position.set(spawn.x, spawn.y ?? geometrySpec.halfSize.y, spawn.z);
    const requestedScale = position?.scale?.clone() ?? mesh.scale.clone();
    if (position?.rotation) mesh.rotation.copy(position.rotation);
    mesh.scale.copy(minimumScale);
    mesh.castShadow = true;
    mesh.receiveShadow = true;

    const entity = {
      id,
      name: position?.name ?? asset?.name ?? nextEntityName(type),
      type,
      geometrySpec,
      mesh,
      model: asset,
      privateModel,
      color: position?.color ?? SOLID_MATERIAL.color,
      materialMode: position?.materialMode ?? 'solid',
      rotationPhase: 0,
      trajectory: null,
      animation: position?.animation ? { ...position.animation } : {
        enabled: false,
        axis: INITIAL_ROTATION_AXIS,
        speed: INITIAL_ROTATION_SPEED,
      },
      lastEditor: position?.lastEditor ?? null,
    };
    if (asset) entity.materialSettings = null;
    else {
      entity.materialController = createMaterialController(mesh, texturePool, failedShaders);
      applyAppearance(entity, entity.color, entity.materialMode, position?.materialSettings);
    }

    entities.set(id, entity);
    mesh.userData.entityId = id;
    scene.add(mesh);
    constrainEntity(entity);
    mesh.scale.copy(requestedScale);
    constrainEntityScale(entity);
    entity.trajectory = normalizeTrajectory(position?.trajectory);
    entity.trajectoryMotion = entity.trajectory?.enabled ? createTrajectoryMotion(entity.trajectory) : null;
    applyVisualPose(entity);
    selectedEntityId = id;
    onSelectionChange(entity);
    if (!entity.privateModel) onEntityCreated(serializeEntity(entity));
    return entity;
  }

  function getDuplicatePosition(entity) {
    const base = validTransforms.get(entity.id);
    baseMatrix.compose(base.position, baseQuaternion.setFromEuler(base.rotation), base.scale);
    const halfSize = halfSizeFor(entity);
    measureBounds(halfSize, baseMatrix);
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
    const originalBounds = entityBounds.clone();
    for (const [offsetX, offsetZ] of offsets) {
      if (
        originalBounds.min.x + offsetX >= -WORKSPACE_LIMIT &&
        originalBounds.max.x + offsetX <= WORKSPACE_LIMIT &&
        originalBounds.min.z + offsetZ >= -WORKSPACE_LIMIT &&
        originalBounds.max.z + offsetZ <= WORKSPACE_LIMIT
      ) {
        const position = {
          x: base.position.x + offsetX,
          y: base.position.y,
          z: base.position.z + offsetZ,
        };
        const candidate = { ...base, position: new THREE.Vector3(position.x, position.y, position.z) };
        if ((!(entity.model || shaderDisplacement(entity.materialSettings)) || baseEnvelopeFits(halfSize, candidate, entity.animation)) &&
            fitsTrajectory(entity.trajectory, candidate, halfSize, entity.animation)) return position;
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
      trajectory: source.trajectory,
      modelAsset: source.model,
    });
  }

  function copyEntityProperties(id) {
    const entity = getEntity(id);
    if (!entity || entity.model) return false;

    copiedProperties = {
      color: entity.color,
      materialMode: entity.materialMode,
      materialSettings: { ...entity.materialSettings },
      scale: validTransforms.get(id).scale.clone(),
      animation: { ...entity.animation },
      trajectory: entity.trajectory,
    };
    return true;
  }

  function applyCopiedProperties(id) {
    const entity = getEntity(id);
    if (!entity || entity.model || !copiedProperties) return false;
    const before = serializeEntity(entity);

    const base = validTransforms.get(id);
    const copiedWave = shaderDisplacement(copiedProperties.materialSettings);
    if (copiedProperties.trajectory?.enabled || copiedWave) {
      const candidate = { ...base, scale: copiedProperties.scale };
      const halfSize = materialHalfSize(entity.geometrySpec.halfSize, copiedProperties.materialSettings, deformedHalfSize);
      baseMatrix.compose(base.position, baseQuaternion.setFromEuler(base.rotation), candidate.scale);
      measureBounds(halfSize, baseMatrix);
      if (!getPositionCorrection() || positionCorrection.lengthSq() > BOUNDS_EPSILON ** 2 ||
          (copiedWave && !baseEnvelopeFits(halfSize, candidate, copiedProperties.animation)) ||
          !fitsTrajectory(copiedProperties.trajectory, candidate, halfSize, copiedProperties.animation)) return false;
    }
    cancelTrajectoryPreview(entity);
    cancelGeometryPreview(entity);
    restoreBase(entity);
    applyAppearance(entity, copiedProperties.color, copiedProperties.materialMode, copiedProperties.materialSettings);
    entity.mesh.scale.set(
      copiedProperties.scale.x,
      copiedProperties.scale.y,
      copiedProperties.scale.z,
    );
    entity.animation = { ...copiedProperties.animation };
    entity.trajectory = copiedProperties.trajectory;
    entity.trajectoryMotion = entity.trajectory?.enabled ? createTrajectoryMotion(entity.trajectory) : null;
    constrainEntityScale(entity);
    applyVisualPose(entity);
    onSelectionChange(entity);
    onEntityChanged(serializeEntity(entity), before);
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

  function releaseMesh({ mesh, materialController, model }) {
    scene.remove(mesh);
    if (model) model.release();
    else {
      mesh.geometry.dispose();
      materialController.dispose();
    }
  }

  function removeEntity(id) {
    const entity = entities.get(id);
    if (!entity) return false;

    cancelGeometryPreview(entity);
    releaseMesh(entity);
    entities.delete(id);
    validTransforms.delete(id);
    if (!entity.privateModel) onEntityDeleted(id);

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
    if (entity.model) return false;
    if (entity.editingTransform) throw new Error('Conclua a transformação antes de editar a geometria.');
    const spec = describeGeometry(type, parameters);
    const committed = entity.geometrySpec;
    if (committed.type === type && sameGeometryParameters(committed.overrides, spec.overrides)) {
      cancelGeometryPreview(entity);
      return false;
    }

    const base = validTransforms.get(entity.id);
    baseMatrix.compose(base.position, baseQuaternion.setFromEuler(base.rotation), base.scale);
    const halfSize = halfSizeFor(entity, spec);
    measureBounds(halfSize, baseMatrix);
    if (!getPositionCorrection()) {
      throw new Error('A geometria não cabe na cena com a escala e a rotação atuais.');
    }
    const wave = shaderDisplacement(effectiveSettings(entity));
    const activeTrajectory = entity.trajectory?.enabled || entity.trajectoryPreview?.settings.enabled || wave;
    if (activeTrajectory && positionCorrection.lengthSq() > BOUNDS_EPSILON ** 2) {
      throw new Error('A geometria ultrapassaria os limites da cena na posição base da trajetória.');
    }
    const correctedPosition = previewOnly || activeTrajectory ? base.position : base.position.clone().add(positionCorrection);
    if (wave && !baseEnvelopeFits(halfSize, base, entity.animation)) throw new Error('A geometria ondulada ultrapassa os limites da cena.');
    requireTrajectoryFit(entity.trajectory, base, halfSize, entity.animation, correctedPosition);
    if (entity.trajectoryPreview?.settings) {
      requireTrajectoryFit(entity.trajectoryPreview.settings, base, halfSize, entity.animation, correctedPosition);
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
    const before = serializeEntity(entity);
    entity.geometryPreview.original.dispose();
    entity.geometryPreview = null;
    if (entity.type !== type) entity.name = nextEntityName(type);
    entity.type = type;
    entity.geometrySpec = spec;
    base.position.copy(correctedPosition);
    applyVisualPose(entity);
    if (entity.id === selectedEntityId) onSelectionChange(entity);
    onEntityChanged(serializeEntity(entity), before);
    return true;
  }

  function replaceGeometry(entity, type) {
    if (type !== entity.type) return setGeometry(entity, type, null);
    return false;
  }

  function applyVisualPose(entity) {
    const halfSize = halfSizeFor(entity, entity.geometryPreview?.spec ?? entity.geometrySpec);
    if (entity.remoteTransformPreview) applyRemoteTransform(entity);
    else restoreBase(entity);
    const motion = entity.trajectoryPreview === undefined ? entity.trajectoryMotion : entity.trajectoryPreview;
    if (motion) {
      applyTrajectoryPose(entity, motion);
      return;
    }
    if (entity.animation.enabled) {
      entity.mesh.rotation[entity.animation.axis] += entity.rotationPhase;
    }
    if (!constrainEntity(entity, false, halfSize) && entity.geometryPreview) {
      // The authored pose fits even if the current animated angle does not.
      constrainEntity(entity, false, halfSize);
    }
  }

  function applyRemoteTransform(entity) {
    const { position, rotation, scale } = entity.remoteTransformPreview;
    entity.mesh.position.set(position.x, position.y, position.z);
    entity.mesh.rotation.set(rotation.x, rotation.y, rotation.z);
    entity.mesh.scale.set(scale.x, scale.y, scale.z);
  }

  function updateAnimations(delta) {
    for (const entity of entities.values()) {
      entity.materialController?.updateTime(delta);
      if (entity.editingTransform) continue;
      const motion = entity.trajectoryPreview === undefined ? entity.trajectoryMotion : entity.trajectoryPreview;
      if (!entity.animation.enabled && !motion) continue;
      if (entity.animation.enabled) {
        const speed = entity.previewRotationSpeed ?? entity.animation.speed;
        entity.rotationPhase = (entity.rotationPhase + THREE.MathUtils.degToRad(speed) * delta) % (2 * Math.PI);
      }
      advanceTrajectory(motion, delta);
      applyVisualPose(entity);
    }
  }

  function applyAppearance(entity, color, materialMode, input) {
    const settings = normalizeMaterialSettings(input);
    entity.materialController.apply(color, materialMode, settings);
    entity.previewMaterialSettings = null;
    const changed = color !== entity.color || materialMode !== entity.materialMode ||
      !sameMaterialSettings(settings, entity.materialSettings);
    entity.color = color;
    entity.materialMode = materialMode;
    entity.materialSettings = settings;
    return changed;
  }

  function setAppearance(entity, color, materialMode = entity.materialMode, settings = entity.materialSettings) {
    if (entity.model) return false;
    ensureShaderFit(entity, normalizeMaterialSettings(settings));
    const before = serializeEntity(entity);
    if (!applyAppearance(entity, color, materialMode, settings)) return false;
    onEntityChanged(serializeEntity(entity), before);
    return true;
  }

  function setMaterialSettings(entity, settings, preview = false) {
    if (entity.model) return;
    if (preview) {
      const next = normalizeMaterialSettings(settings);
      ensureShaderFit(entity, next);
      entity.materialController.apply(entity.color, entity.materialMode, next);
      entity.previewMaterialSettings = sameMaterialSettings(next, entity.materialSettings) ? null : next;
    } else {
      setAppearance(entity, entity.color, entity.materialMode, settings);
    }
  }

  function cancelMaterialPreview(entity) {
    if (!entity.previewMaterialSettings) return;
    entity.previewMaterialSettings = null;
    entity.materialController.apply(entity.color, entity.materialMode, entity.materialSettings);
  }

  function setAnimation(entity, changes) {
    const animation = { ...entity.animation, ...changes };
    if (Object.keys(changes).every((key) => animation[key] === entity.animation[key])) return;
    const before = serializeEntity(entity);
    const base = validTransforms.get(entity.id);
    if ((entity.model || shaderDisplacement(effectiveSettings(entity))) &&
        (!baseEnvelopeFits(halfSizeFor(entity), base, animation) ||
        !baseEnvelopeFits(halfSizeFor(entity, entity.geometryPreview?.spec ?? entity.geometrySpec), base, animation))) {
      throw new Error('A rotação completa ultrapassa os limites da cena. Eleve o objeto ou reduza a escala.');
    }
    requireTrajectoryFit(entity.trajectory, base, halfSizeFor(entity), animation);
    if (entity.geometryPreview) {
      requireTrajectoryFit(entity.trajectory, base, halfSizeFor(entity, entity.geometryPreview.spec), animation);
    }
    requireTrajectoryFit(entity.trajectoryPreview?.settings, validTransforms.get(entity.id),
      halfSizeFor(entity, entity.geometryPreview?.spec ?? entity.geometrySpec), animation);
    if (animation.enabled !== entity.animation.enabled || animation.axis !== entity.animation.axis) {
      entity.rotationPhase = 0;
      restoreBase(entity);
    }
    entity.animation = animation;
    applyVisualPose(entity);
    onEntityChanged(serializeEntity(entity), before);
  }

  function setMutationHandlers(handlers = {}) {
    onEntityCreated = handlers.onCreated ?? (() => {});
    onEntityDeleted = handlers.onDeleted ?? (() => {});
    onEntityChanged = (snapshot, before) => {
      if (snapshot.type !== PRIVATE_MODEL) handlers.onChanged?.(snapshot, before);
    };
  }

  function clearEntities() {
    for (const entity of entities.values()) {
      cancelGeometryPreview(entity);
      releaseMesh(entity);
      validTransforms.delete(entity.id);
    }
    entities.clear();
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
        trajectory: snapshot.trajectory,
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
        trajectory: snapshot.trajectory,
        geometryParameters: snapshot.geometryParameters,
        lastEditor: snapshot.lastEditor,
      });
      entity = getEntity(snapshot.id);
    } else {
      entity.remoteTransformPreview = null;
      const base = validTransforms.get(entity.id);
      cancelTrajectoryPreview(entity);
      const trajectory = normalizeTrajectory(snapshot.trajectory);
      const trajectoryChanged = !sameTrajectory(entity.trajectory, trajectory);
      if (entity.trajectory?.enabled && !trajectory?.enabled) entity.rotationPhase = 0;
      cancelGeometryPreview(entity);
      const typeChanged = entity.type !== snapshot.type;
      const spec = entity.model ? entity.geometrySpec : describeGeometry(snapshot.type, snapshot.geometryParameters);
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
      if (!entity.model) applyAppearance(entity, snapshot.color, snapshot.materialMode, snapshot.materialSettings);
      entity.animation = { ...snapshot.animation };
      entity.trajectory = trajectory;
      if (trajectoryChanged) entity.trajectoryMotion = trajectory?.enabled ? createTrajectoryMotion(trajectory) : null;
      entity.lastEditor = snapshot.lastEditor ?? null;
      if (restart) {
        entity.mesh.position.set(snapshot.position.x, snapshot.position.y, snapshot.position.z);
        entity.mesh.rotation.set(snapshot.rotation.x, snapshot.rotation.y, snapshot.rotation.z);
        entity.mesh.scale.set(snapshot.scale.x, snapshot.scale.y, snapshot.scale.z);
        constrainEntity(entity);
      }
      applyVisualPose(entity);
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
    return getEntities().filter((entity) => !entity.privateModel).map((entity) => serializeEntity(entity));
  }

  function setPrivateModelsVisible(visible) {
    if (privateVisible === visible && !visible) return parkedModels.size;
    privateVisible = visible;
    if (!visible) {
      for (const [id, entity] of entities) {
        if (!entity.privateModel) continue;
        scene.remove(entity.mesh);
        entities.delete(id);
        parkedModels.set(id, entity);
      }
      if (!entities.has(selectedEntityId)) selectedEntityId = entities.keys().next().value ?? null;
    } else {
      for (const [id, entity] of parkedModels) {
        if (entities.size >= 100) break;
        try {
          validateModelBudget([...getEntities().filter((item) => item.model).map((item) => item.model.info), entity.model.info]);
        } catch {
          continue;
        }
        entities.set(id, entity);
        scene.add(entity.mesh);
        selectedEntityId ??= id;
        parkedModels.delete(id);
      }
    }
    onSelectionChange(getSelectedEntity());
    return parkedModels.size;
  }

  function applyEntityBatch(snapshots, replace) {
    const previousSelection = selectedEntityId;
    const previousIds = new Set(entities.keys());
    const previousEntity = getSelectedEntity();
    const selectionHandler = onSelectionChange;
    onSelectionChange = () => {};
    try {
      for (const snapshot of snapshots) {
        if (!previousIds.has(snapshot.id)) applyEntitySnapshot(snapshot);
      }
    } catch (error) {
      for (const id of entities.keys()) if (!previousIds.has(id)) removeEntity(id);
      selectedEntityId = previousSelection;
      throw error;
    } finally {
      onSelectionChange = selectionHandler;
    }
    if (replace) {
      onSelectionChange = () => {};
      try {
        for (const id of previousIds) removeEntity(id);
      } finally {
        onSelectionChange = selectionHandler;
      }
    } else if (previousEntity) {
      selectedEntityId = previousSelection;
    }
    if (replace || !previousEntity) onSelectionChange(getSelectedEntity());
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
    setPrivateModelsVisible,
    applyEntityBatch,
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
    refreshShaderFallbacks() {
      for (const entity of entities.values()) entity.materialController?.refreshFallback();
    },
    requiresStrictBounds: (entity) => Boolean(entity.trajectory?.enabled || entity.model || shaderDisplacement(effectiveSettings(entity))),
    setAppearance,
    setMaterialSettings,
    cancelMaterialPreview,
    setAnimation,
    setTrajectory,
    cancelTrajectoryPreview,
    applyVisualPose,
    setMutationHandlers,
    applyRemoteTransformPreview(snapshot) {
      const entity = getEntity(snapshot.id);
      if (!entity || entity.editingTransform) return;
      entity.remoteTransformPreview = snapshot;
      applyVisualPose(entity);
    },
    clearRemoteTransformPreview(id) {
      const entity = getEntity(id);
      if (!entity?.remoteTransformPreview) return;
      entity.remoteTransformPreview = null;
      if (!entity.editingTransform) applyVisualPose(entity);
    },
    serializeEntity: (id, pose) => {
      const entity = getEntity(id);
      return entity ? serializeEntity(entity, pose) : null;
    },
    replaceEntities,
    dispose() {
      setMutationHandlers();
      onSelectionChange = () => {};
      clearEntities();
      for (const entity of parkedModels.values()) releaseMesh(entity);
      parkedModels.clear();
      validTransforms.clear();
      copiedProperties = null;
      nameCounters.clear();
    },
    applyEntitySnapshot,
    removeRemoteEntity,
    getSharedEntities,
  };
}

