import { changeLighting, DEFAULT_LIGHTING, sameLighting } from './graphics/lighting-settings.js';
import { createRoomSettingsSession } from './room-settings-session.js';

export function createLightingSession(handlers) {
  const session = createRoomSettingsSession({
    ...handlers,
    initial: DEFAULT_LIGHTING,
    change: (settings, { group, patch }) => changeLighting(settings, group, patch),
    equal: sameLighting,
    stateValue: (snapshot) => snapshot.settings,
  });
  return {
    ...session,
    preview: (group, patch) => session.preview({ group, patch }),
    commit: (group, patch) => session.commit({ group, patch }),
  };
}
