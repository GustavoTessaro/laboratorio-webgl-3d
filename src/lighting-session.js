import { changeLighting, DEFAULT_LIGHTING, sameLighting } from './graphics/lighting-settings.js';

export function createLightingSession({ render, send, onError }) {
  let confirmed = DEFAULT_LIGHTING;
  let revision = -1;
  let preview = null;
  let remote = false;
  let online = false;
  let epoch = 0;
  let connectionEpoch = 0;
  let sending = false;
  const queued = [];

  function apply(settings, { group, patch }) {
    return changeLighting(settings, group, patch);
  }

  function view(includePreview = true) {
    let settings = confirmed;
    for (const command of queued) {
      try { settings = apply(settings, command); } catch { /* The server will validate the queued command. */ }
    }
    if (includePreview && preview) {
      try { settings = apply(settings, preview); } catch { /* A concurrent edit can invalidate a preview. */ }
    }
    return settings;
  }

  function refresh() { render(view()); }

  function accept(state) {
    if (!state || state.revision < revision) return;
    revision = state.revision;
    confirmed = state.settings;
    refresh();
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
          accept(state);
          refresh();
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
    accept,
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
    preview(group, patch) {
      const command = { group, patch };
      apply(view(false), command);
      preview = command;
      refresh();
    },
    cancel() {
      if (!preview) return;
      preview = null;
      refresh();
    },
    commit(group, patch) {
      preview = null;
      const current = view(false);
      const command = { group, patch };
      let next;
      try {
        next = apply(current, command);
      } catch (error) {
        refresh();
        throw error;
      }
      if (!sameLighting(current, next)) {
        if (remote) queued.push(command);
        else confirmed = next;
      }
      refresh();
      void flush();
    },
  };
}
