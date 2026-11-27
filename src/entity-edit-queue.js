// Rendering can replay later local gestures only on their exact authored base.
// The server alone decides whether changes can merge on a different base.
export function createEntityEditJournal(equal) {
  const outstanding = new Set();
  return {
    track(operation) { outstanding.add(operation); },
    finish(operation) { outstanding.delete(operation); },
    clear() { outstanding.clear(); },
    hasEarlier(operation) {
      for (const current of outstanding) {
        if (current === operation) break;
        if (current.entity.id === operation.entity.id) return true;
      }
      return false;
    },
    project(confirmed) {
      let visible = confirmed;
      for (const { before, entity } of outstanding) {
        if (before.id === confirmed.id && equal(visible, before)) {
          visible = { ...entity, lastEditor: confirmed.lastEditor };
        }
      }
      return visible;
    },
  };
}

export async function deliverEntityEdit(client, operation, exists) {
  const { entity, before, final, isCurrent } = operation;
  if (isCurrent && !isCurrent()) return { status: 'obsolete' };
  if (!client?.connected) return { status: 'offline' };
  if (!exists(entity.id)) return { status: 'removed' };
  const connectionId = client.connection.connectionId;
  const stillConnected = () => client.connected && client.connection.connectionId === connectionId;
  const lock = await client.acquireEditLock(entity.id);
  if (!stillConnected()) return { status: 'offline' };
  if (!lock.granted) return { status: 'locked', lock };
  if (isCurrent && !isCurrent()) return { status: 'obsolete', acquired: true };
  if (!exists(entity.id)) return { status: 'removed', acquired: true };
  await client.updateEntity({ before, after: entity, final });
  return { status: stillConnected() ? 'sent' : 'offline', acquired: true };
}
