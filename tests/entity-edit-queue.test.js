import assert from 'node:assert/strict';
import test from 'node:test';
import { createEntityEditJournal, deliverEntityEdit } from '../src/entity-edit-queue.js';
import { Scene } from 'three';
import { createEntityRegistry } from '../src/graphics/entity-registry.js';

const blue = { id: 'box', color: 'blue', x: 0 };
const red = { ...blue, color: 'red' };
const moved = { ...blue, x: 2 };
const edit = { before: blue, entity: red, final: true };

function fixture() {
  let unlock;
  const waiting = new Promise((resolve) => { unlock = resolve; });
  const invocations = [];
  const client = {
    connected: true,
    connection: { connectionId: 'before' },
    acquireEditLock: () => waiting,
    async updateEntity(command) { invocations.push(command); return { ...red, x: 99 }; },
  };
  return { client, unlock, invocations };
}

test('an update received while awaiting the lease cannot replace the gesture baseline', async () => {
  const { client, unlock, invocations } = fixture();
  let authority = blue;
  const task = deliverEntityEdit(client, edit, () => Boolean(authority));
  authority = moved;
  unlock({ granted: true });
  assert.deepEqual(await task, { status: 'sent', acquired: true });
  assert.deepEqual(invocations, [{ before: blue, after: red, final: true }]);
  // Invocation responses are acknowledgements. The room event alone updates authority.
  assert.equal(authority.x, 2);
});

test('a lease from an older transport is discarded and the same intent can be resent', async () => {
  const { client, unlock, invocations } = fixture();
  const task = deliverEntityEdit(client, edit, () => true);
  client.connection.connectionId = 'rejoined';
  unlock({ granted: true });
  assert.equal((await task).status, 'offline');
  assert.deepEqual(invocations, []);
  assert.equal((await deliverEntityEdit(client, edit, () => true)).status, 'sent');
  assert.deepEqual(invocations, [{ before: blue, after: red, final: true }]);
});

test('deletion or replacement during acquisition cannot submit or recreate an old object', async () => {
  const { client, unlock, invocations } = fixture();
  let exists = true;
  const waiting = deliverEntityEdit(client, edit, () => exists);
  exists = false;
  unlock({ granted: true });
  assert.deepEqual(await waiting, { status: 'removed', acquired: true });
  assert.deepEqual(invocations, []);
});

test('obsolete transform previews are dropped even after the lease was requested', async () => {
  const { client, unlock, invocations } = fixture();
  let valid = true;
  const task = deliverEntityEdit(client, { ...edit, final: false, isCurrent: () => valid }, () => true);
  valid = false;
  unlock({ granted: true });
  assert.equal((await task).status, 'obsolete');
  assert.deepEqual(invocations, []);
});

test('a later gesture retains its own baseline across prior echoes and rejection', () => {
  const equal = (a, b) => a.id === b.id && a.x === b.x && a.color === b.color;
  const journal = createEntityEditJournal(equal);
  const green = { ...red, color: 'green' };
  const second = { before: red, entity: green, final: true };
  journal.track(edit);
  journal.track(second);
  assert.equal(journal.hasEarlier(second), true);
  assert.equal(journal.project(blue).color, 'green');
  assert.deepEqual(journal.project(moved), moved);
  assert.equal(journal.project(red).color, 'green');
  journal.finish(edit);
  assert.equal(journal.hasEarlier(second), false);
  assert.equal(journal.project(red).color, 'green');
  journal.finish(second);
  assert.deepEqual(journal.project({ ...red, x: 2 }), { ...red, x: 2 });
});

test('remote previews are visual and an authored change captures the stable baseline', () => {
  const registry = createEntityRegistry(new Scene());
  const entity = registry.createEntity('box', { x: 0, y: 3, z: 0 });
  registry.setAnimation(entity, { enabled: true });
  const original = registry.serializeEntity(entity.id);
  const edits = [];
  registry.setMutationHandlers({ onChanged: (after, before) => edits.push({ after, before }) });
  registry.applyRemoteTransformPreview({ ...original, position: { ...original.position, x: 2 } });
  for (let i = 0; i < 5; i++) registry.updateAnimations(0.05);
  assert.equal(entity.mesh.position.x, 2);
  assert.equal(registry.serializeEntity(entity.id).position.x, 0);
  assert.deepEqual(edits, []);
  registry.setAppearance(entity, '#f06b6b');
  assert.deepEqual(edits, [{ before: original, after: { ...original, color: '#f06b6b' } }]);
  registry.clearRemoteTransformPreview(entity.id);
  assert.equal(entity.mesh.position.x, 0);
  registry.dispose();
});
