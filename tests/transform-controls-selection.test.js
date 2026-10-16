import assert from 'node:assert/strict';
import test from 'node:test';
import * as THREE from 'three';
import { TransformControls } from 'three/addons/controls/TransformControls.js';
import { synchronizeTransformTarget } from '../src/scene.js';

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
