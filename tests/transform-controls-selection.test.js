import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { bindTransformEditing, createEntityRegistry, synchronizeTransformTarget } from '../src/scene.js';

test('TransformControls targets the selected mesh in every mode', () => {
  const camera = new THREE.PerspectiveCamera();
  const scene = new THREE.Scene();
  const firstEntity = { mesh: new THREE.Mesh() };
  const secondEntity = { mesh: new THREE.Mesh() };
  scene.add(firstEntity.mesh, secondEntity.mesh);
  const transformControls = new TransformControls(camera);

  for (const mode of ['translate', 'rotate', 'scale']) {
    synchronizeTransformTarget(transformControls, firstEntity, mode);
    assert.strictEqual(transformControls.object, firstEntity.mesh);
    assert.equal(transformControls.mode, mode);
    assert.equal(transformControls.space, mode === 'scale' ? 'local' : 'world');
    assert.equal(transformControls.enabled, true);

    synchronizeTransformTarget(transformControls, secondEntity, mode);
    assert.strictEqual(transformControls.object, secondEntity.mesh);
    assert.equal(transformControls.mode, mode);
  }

  synchronizeTransformTarget(transformControls, null, null);
  assert.equal(transformControls.object, undefined);
  assert.equal(transformControls.enabled, false);
  assert.equal(transformControls.getHelper().visible, false);
});

test('local and world edits apply native axis deltas to the authored pose during animation', () => {
  const localX = new THREE.Vector3(1, 0, 0);
  const delta = new THREE.Quaternion().setFromAxisAngle(localX, 0.25);
  for (const space of ['local', 'world']) {
    for (const mode of ['translate', 'rotate', 'scale']) {
      const registry = createEntityRegistry(new THREE.Scene());
      const entity = registry.createEntity('box', {
        x: 0, y: 4, z: 0,
        rotation: new THREE.Euler(0.3, 0.7, -0.2),
        animation: { enabled: true, axis: 'y', speed: 90 },
      });
      const base = entity.mesh.quaternion.clone();
      registry.updateAnimations(0.5);
      const visual = entity.mesh.quaternion.clone();
      const gizmo = new TransformControls(new THREE.PerspectiveCamera());
      synchronizeTransformTarget(gizmo, entity, mode, space);
      assert.equal(gizmo.space, mode === 'scale' ? 'local' : space);
      const committed = [];
      bindTransformEditing(gizmo, registry, { onEnd: (_, snapshot) => committed.push(snapshot) });
      gizmo.axis = 'X';
      gizmo.dragging = true;
      if (mode === 'translate') {
        const offset = localX.clone();
        if (space === 'local') offset.applyQuaternion(visual);
        entity.mesh.position.add(offset);
      } else if (mode === 'rotate') {
        if (space === 'local') entity.mesh.quaternion.multiply(delta);
        else entity.mesh.quaternion.premultiply(delta);
      } else {
        entity.mesh.scale.x = 1.8;
      }
      gizmo.dispatchEvent({ type: 'objectChange' });
      gizmo.dragging = false;
      assert.equal(committed.length, 1);
      const snapshot = committed[0];
      assert.deepEqual(snapshot.animation, { enabled: true, axis: 'y', speed: 90 });
      const expectedRotation = base.clone();
      if (mode === 'rotate') {
        if (space === 'local') expectedRotation.multiply(delta);
        else expectedRotation.premultiply(delta);
      }
      assert.ok(entity.mesh.quaternion.angleTo(expectedRotation) < 1e-6);
      if (mode === 'translate') {
        const expected = localX.clone();
        if (space === 'local') expected.applyQuaternion(base);
        expected.y += 4;
        assert.ok(expected.distanceTo(new THREE.Vector3(...Object.values(snapshot.position))) < 1e-6);
      }
      assert.equal(snapshot.scale.x, mode === 'scale' ? 1.8 : 1);
      registry.dispose();
    }
  }
});

test('the gizmo final snapshot preserves automatic rotation in every mode', () => {
  for (const mode of ['translate', 'rotate', 'scale']) {
    const scene = new THREE.Scene();
    const registry = createEntityRegistry(scene);
    const entity = registry.createEntity('box');
    entity.animation.enabled = true;
    registry.updateAnimations(0.5);
    const visualRotation = entity.mesh.rotation.y;
    const base = registry.serializeEntity(entity.id);
    const gizmo = new TransformControls(new THREE.PerspectiveCamera());
    synchronizeTransformTarget(gizmo, entity, mode);
    const snapshots = [];
    bindTransformEditing(gizmo, registry, {
      onEnd: (_, snapshot) => snapshots.push(snapshot),
    });
    gizmo.dragging = true;
    registry.updateAnimations(0.1);
    assert.equal(entity.mesh.rotation.y, visualRotation);
    assert.equal(registry.serializeEntity(entity.id).animation.enabled, true);
    if (mode === 'translate') entity.mesh.position.x += 1;
    if (mode === 'rotate') entity.mesh.rotation.y += 0.2;
    if (mode === 'scale') entity.mesh.scale.x += 0.2;
    gizmo.dispatchEvent({ type: 'objectChange' });
    gizmo.dragging = false;
    assert.equal(snapshots.length, 1);
    assert.equal(snapshots[0].animation.enabled, true);
    if (mode !== 'rotate') assert.deepEqual(snapshots[0].rotation, base.rotation);
    else assert.ok(Math.abs(snapshots[0].rotation.y - 0.2) < 1e-6);
    const rotation = entity.mesh.rotation.y;
    registry.updateAnimations(0.1);
    assert.notEqual(entity.mesh.rotation.y, rotation);
  }
});

test('a cancelled or unchanged gizmo edit leaves the base untouched', () => {
  const registry = createEntityRegistry(new THREE.Scene());
  const entity = registry.createEntity('box');
  const gizmo = new TransformControls(new THREE.PerspectiveCamera());
  synchronizeTransformTarget(gizmo, entity, 'translate');
  const ended = [];
  const editing = bindTransformEditing(gizmo, registry, {
    onEnd: (id, snapshot) => ended.push([id, snapshot]),
  });
  const before = registry.serializeEntity(entity.id);
  gizmo.dragging = true;
  entity.mesh.position.x += 2;
  gizmo.dispatchEvent({ type: 'objectChange' });
  registry.createEntity('sphere');
  editing.cancel();
  assert.equal(gizmo.dragging, false);
  assert.deepEqual(registry.serializeEntity(entity.id), before);
  assert.deepEqual(entity.mesh.position.toArray(), Object.values(before.position));

  synchronizeTransformTarget(gizmo, entity, 'translate');
  gizmo.dragging = true;
  gizmo.dragging = false;
  assert.deepEqual(ended, [[entity.id, null], [entity.id, null]]);
});
