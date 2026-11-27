const rangeKeys = new Set(['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'Home', 'End', 'PageUp', 'PageDown']);

export function bindLocalInput(input, { getEntity, preview, restore, commit, signal }) {
  let edit = null;
  const heldKeys = new Set();

  function finish(cancelled) {
    heldKeys.clear();
    if (!edit) return;
    const { entity, value } = edit;
    edit = null;
    const willCommit = !cancelled && getEntity() === entity;
    restore(entity, willCommit);
    if (willCommit) commit(value, entity);
  }

  input.addEventListener('input', () => {
    const entity = getEntity();
    if (!entity || input.disabled) return;
    if (edit && edit.entity !== entity) finish(true);
    edit = { entity, value: input.value };
    preview(edit.value, entity);
  }, { signal });
  input.addEventListener('change', () => {
    if (heldKeys.size === 0) finish(false);
  }, { signal });
  input.addEventListener('blur', () => finish(false), { signal });
  input.addEventListener('pointercancel', () => finish(true), { signal });
  input.addEventListener('keydown', (event) => {
    if (event.key === 'Escape') finish(true);
    if (['range', 'number'].includes(input.type) && rangeKeys.has(event.key)) heldKeys.add(event.key);
  }, { signal });
  input.addEventListener('keyup', (event) => {
    if (heldKeys.delete(event.key) && heldKeys.size === 0) finish(false);
  }, { signal });

  return {
    get entity() { return edit?.entity; },
    cancel: () => finish(true),
  };
}

export function createTransformPreviews(send, timers = globalThis) {
  const edits = new Map();

  function end(id) {
    const edit = edits.get(id);
    if (!edit) return;
    timers.clearTimeout(edit.timer);
    edits.delete(id);
  }

  return {
    start(id) {
      end(id);
      edits.set(id, { timer: null, latest: null });
    },
    push(snapshot) {
      const edit = edits.get(snapshot.id);
      if (!edit) return;
      edit.latest = snapshot;
      if (edit.timer !== null) return;
      edit.timer = timers.setTimeout(() => {
        edit.timer = null;
        send(edit.latest, () => edits.get(snapshot.id) === edit);
      }, 100);
    },
    end,
  };
}
