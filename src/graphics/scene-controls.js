import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { BOUNDS_EPSILON } from './scene-assets.js';

export function createSceneControls(scene, camera, canvas) {
  const controls = new OrbitControls(camera, canvas);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.minDistance = 1.8;
  controls.maxDistance = 30;
  controls.target.set(0, 0.5, 0);
  controls.cursor.set(0, 0.5, 0);
  controls.maxTargetRadius = Math.hypot(12, 11.5, 12);

  const transformControls = new TransformControls(camera, canvas);
  transformControls.setMode('translate');
  transformControls.setSpace('world');
  const transformHelper = transformControls.getHelper();
  transformHelper.visible = false;
  scene.add(transformHelper);
  return { controls, transformControls, transformHelper };
}

export function synchronizeTransformTarget(transformControls, entity, mode) {
  if (!entity) {
    transformControls.detach();
    transformControls.enabled = false;
    transformControls.getHelper().visible = false;
    return;
  }

  if (transformControls.object !== entity.mesh) {
    transformControls.detach();
    transformControls.attach(entity.mesh);
  }
  if (mode) transformControls.setMode(mode);
  transformControls.enabled = Boolean(mode);
  transformControls.getHelper().visible = Boolean(mode);
}

export function bindTransformEditing(controls, registry, { onStart, onPreview, onEnd }) {
  let edit = null;

  function setPose(mesh, pose) {
    mesh.position.set(pose.position.x, pose.position.y, pose.position.z);
    mesh.rotation.set(pose.rotation.x, pose.rotation.y, pose.rotation.z);
    mesh.scale.set(pose.scale.x, pose.scale.y, pose.scale.z);
  }

  function getEditedSnapshot({ entity, initialPose, mode }, final) {
    const { mesh } = entity;
    const pose = registry.serializeEntity(entity.id, mesh);
    const base = registry.serializeEntity(entity.id);
    const key = { translate: 'position', rotate: 'rotation', scale: 'scale' }[mode];
    const changed = ['x', 'y', 'z'].some((axis) =>
      Math.abs(pose[key][axis] - initialPose[key][axis]) > BOUNDS_EPSILON);
    if (!changed) return null;

    registry.restoreBase(entity);
    if (mode === 'translate') {
      mesh.position.x += pose.position.x - initialPose.position.x;
      mesh.position.y += pose.position.y - initialPose.position.y;
      mesh.position.z += pose.position.z - initialPose.position.z;
    } else if (mode === 'rotate') {
      const before = new THREE.Euler(initialPose.rotation.x, initialPose.rotation.y, initialPose.rotation.z);
      const after = new THREE.Euler(pose.rotation.x, pose.rotation.y, pose.rotation.z);
      const delta = new THREE.Quaternion().setFromEuler(after)
        .multiply(new THREE.Quaternion().setFromEuler(before).invert());
      mesh.quaternion.premultiply(delta);
    } else {
      mesh.scale.set(pose.scale.x, pose.scale.y, pose.scale.z);
    }
    if (mode === 'scale') registry.constrainEntityScale(entity, false);
    else registry.constrainEntity(entity, false);

    const snapshot = registry.serializeEntity(entity.id, mesh);
    const changedBase = ['position', 'rotation', 'scale'].some((part) =>
      ['x', 'y', 'z'].some((axis) => Math.abs(snapshot[part][axis] - base[part][axis]) > BOUNDS_EPSILON),
    );
    if (final && changedBase) registry.constrainEntity(entity);
    else setPose(mesh, pose);
    return changedBase ? snapshot : null;
  }

  function finish(cancelled) {
    if (!edit) return;
    const current = edit;
    const { entity } = current;
    edit = null;
    const snapshot = cancelled ? null : getEditedSnapshot(current, true);
    entity.editingTransform = false;
    if (!snapshot) registry.restoreBase(entity);
    onEnd?.(entity.id, snapshot);
  }

  function handleDraggingChanged({ value }) {
    if (!value) {
      finish(false);
      return;
    }
    const entity = registry.getEntity(controls.object?.userData.entityId);
    if (!entity) return;
    edit = { entity, mode: controls.mode, initialPose: registry.serializeEntity(entity.id, entity.mesh) };
    entity.editingTransform = true;
    onStart?.(entity.id);
  }

  function handleObjectChange() {
    if (!edit) return;
    const { entity } = edit;
    if (controls.mode === 'scale') registry.constrainEntityScale(entity, false);
    else registry.constrainEntity(entity, false);
    const snapshot = getEditedSnapshot(edit, false);
    if (snapshot || edit.hasPreview) {
      edit.hasPreview = Boolean(snapshot);
      onPreview?.(snapshot ?? registry.serializeEntity(entity.id));
    }
  }

  function cancel() {
    if (!edit) return;
    finish(true);
    controls.pointerUp(null);
  }

  controls.addEventListener('dragging-changed', handleDraggingChanged);
  controls.addEventListener('objectChange', handleObjectChange);

  return {
    get entityId() { return edit?.entity.id; },
    cancel,
    dispose() {
      cancel();
      controls.removeEventListener('dragging-changed', handleDraggingChanged);
      controls.removeEventListener('objectChange', handleObjectChange);
    },
  };
}

