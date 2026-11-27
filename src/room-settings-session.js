export function createRoomSettingsSession({ initial, change, equal, stateValue, render, send, onError }) {
  let confirmed = initial;
  let revision = -1;
  let preview = null;
  let remote = false;
  let online = false;
  let epoch = 0;
  let connectionEpoch = 0;
  let sending = false;
  const queued = [];

  function view(includePreview = true) {
    let settings = confirmed;
    for (const command of queued) {
      try { settings = change(settings, command); } catch { /* The server will validate the queued command. */ }
    }
    if (includePreview && preview) {
      try { settings = change(settings, preview); } catch { /* A concurrent edit can invalidate a preview. */ }
    }
    return settings;
  }

  function refresh() { render(view()); }

  function accept(state) {
    if (!state || state.revision < revision) return false;
    revision = state.revision;
    confirmed = stateValue(state);
    refresh();
    return true;
  }

  async function flush() {
    if (sending || !online || !queued.length) return;
    sending = true;
    const version = epoch;
    try {
      while (version === epoch && online && queued.length) {
        const command = queued[0];
        const connection = connectionEpoch;
        try {
          const state = await send(command);
          if (version !== epoch || connection !== connectionEpoch) return;
          queued.shift();
          if (!accept(state)) refresh();
        } catch (error) {
          if (version !== epoch || connection !== connectionEpoch || !online) return;
          queued.shift();
          onError(error.message);
          refresh();
        }
      }
    } finally {
      sending = false;
      if (online && queued.length) void flush();
    }
  }

  return {
    accept(state) { accept(state); },
    resume(state) {
      remote = online = true;
      accept(state);
      void flush();
    },
    pause() {
      online = false;
      connectionEpoch += 1;
      revision = -1;
      preview = null;
      refresh();
    },
    leave() {
      confirmed = view(false);
      preview = null;
      remote = online = false;
      revision = -1;
      epoch += 1;
      queued.length = 0;
      refresh();
    },
    preview(command) {
      change(view(false), command);
      preview = command;
      refresh();
    },
    cancel() {
      if (!preview) return;
      preview = null;
      refresh();
    },
    commit(command) {
      preview = null;
      const current = view(false);
      let next;
      try {
        next = change(current, command);
      } catch (error) {
        refresh();
        throw error;
      }
      if (!equal(current, next)) {
        if (remote) queued.push(command);
        else confirmed = next;
      }
      refresh();
      void flush();
    },
  };
}
