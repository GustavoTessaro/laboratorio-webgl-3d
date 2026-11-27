import './style.css';
import { createScene } from './scene.js';
import { CollaborationClient, COLLABORATION_PROTOCOL_VERSION } from './collaboration.js';
import { sameGeometryParameters } from './graphics/geometries.js';
import { sameMaterialSettings } from './graphics/object-materials.js';
import { createTransformPreviews } from './edit-gestures.js';
import { createControlsPanel } from './controls-panel.js';
import { bindLightingControls } from './lighting-controls.js';
import { createLightingSession } from './lighting-session.js';
import { createRoomSettingsSession } from './room-settings-session.js';
import { bindParticleControls } from './particle-controls.js';
import { bindInspectorControls } from './inspector-controls.js';
import { changeParticles, EMPTY_PARTICLES, sameParticleSettings } from './graphics/particle-settings.js';

const container = document.querySelector('#scene-container');
const message = document.querySelector('#webgl-message');
const collaborationStatus = document.querySelector('#collaboration-status');
const collaborationOpenButton = document.querySelector('#collaboration-open');
const collaborationDialog = document.querySelector('#collaboration-dialog');
const collaborationForm = document.querySelector('#collaboration-form');
const collaborationSubmitButton = collaborationForm.querySelector('[type="submit"]');
const collaborationNameInput = document.querySelector('#collaboration-name');
const collaborationMessage = document.querySelector('#collaboration-message');
const participantList = document.querySelector('#participant-list');
const useLocalButton = document.querySelector('[data-collaboration-local]');

function sameEntityState(first, second) {
  if (!first || !second) return first === second;
  return ['id', 'name', 'type', 'color', 'materialMode'].every((key) => first[key] === second[key]) &&
    sameGeometryParameters(first.geometryParameters, second.geometryParameters) &&
    sameMaterialSettings(first.materialSettings, second.materialSettings) &&
    ['position', 'rotation', 'scale'].every((key) =>
      ['x', 'y', 'z'].every((axis) => first[key][axis] === second[key][axis]),
    ) &&
    ['enabled', 'axis', 'speed'].every((key) => first.animation[key] === second.animation[key]);
}

const pageLifetime = new AbortController();
const { signal } = pageLifetime;
let disposePage;

try {
  const sceneControls = createScene(container);
  disposePage = sceneControls.dispose;
  const serverEntities = new Map();
  const participants = new Map();
  const editLocks = new Map();
  const pendingOperations = [];
  const activeEdits = new Map();
  const previews = createTransformPreviews((entity, isCurrent) =>
    enqueueOperation({ kind: 'update', entity, final: false, isCurrent }),
  );
  let inFlightUpdate = null;
  let collaborationClient = null;
  let collaborationConnected = false;
  let operationQueue = Promise.resolve();
  let displayName = '';
  let connectionAttemptInProgress = false;
  let connectionAttemptId = 0;

  const panel = createControlsPanel(document.querySelector('.controls-panel'), sceneControls, {
    getLock: (id) => editLocks.get(id),
    isLocked(id) {
      const lock = editLocks.get(id);
      return Boolean(lock && lock.participantId !== collaborationClient?.connection.connectionId);
    },
    onDelete(id) {
      if (collaborationConnected) enqueueOperation({ kind: 'delete', id });
      else sceneControls.removeEntity(id);
    },
  });
  const { syncSelectedEntity, renderEntityList, cancelLocalInputs } = panel;
  const lightingSession = createLightingSession({
    render(settings) {
      if (signal.aborted) return;
      sceneControls.applyLighting(settings);
      lightingControls.sync(settings);
    },
    send: (command) => collaborationClient.updateLighting(command),
    onError: (error) => lightingControls.report(error),
  });
  const lightingControls = bindLightingControls(
    document.querySelector('.lighting-controls'), lightingSession, sceneControls.setLightingHelper, signal,
  );
  const particleSession = createRoomSettingsSession({
    initial: EMPTY_PARTICLES,
    change: changeParticles,
    equal: sameParticleSettings,
    stateValue: (snapshot) => snapshot.effects,
    render(settings) {
      if (signal.aborted) return;
      sceneControls.particles.apply(settings);
      particleControls.sync(settings);
    },
    send: (command) => collaborationClient.updateParticles(command),
    onError: (error) => particleControls.report(error),
  });
  const particleControls = bindParticleControls(
    document.querySelector('.particle-controls'), particleSession, sceneControls.particles, signal,
  );
  bindInspectorControls(document.querySelector('[data-graphics-inspector]'), sceneControls.inspector, signal);

  disposePage = () => {
    pageLifetime.abort();
    for (const id of activeEdits.keys()) previews.end(id);
    activeEdits.clear();
    lightingSession.leave();
    particleSession.leave();
    panel.dispose();
    sceneControls.dispose();
    void collaborationClient?.stop().catch(console.warn);
  };

  function setCollaborationStatus(state, text) {
    if (signal.aborted) return;
    collaborationStatus.dataset.state = state;
    collaborationStatus.textContent = text;
    collaborationConnected = state === 'connected';
    const buttonText = {
      connected: 'Conectado',
      connecting: 'Conectando à sala...',
      reconnecting: 'Reconectando à sala...',
      error: 'Tentar novamente',
      disconnected: 'Conectar',
    }[state] ?? 'Conectar';
    const loading = state === 'connecting' || state === 'reconnecting';
    collaborationOpenButton.textContent = buttonText;
    collaborationSubmitButton.textContent = buttonText;
    collaborationOpenButton.dataset.loading = String(loading);
    collaborationSubmitButton.dataset.loading = String(loading);
    collaborationOpenButton.disabled = state === 'connected' || loading;
    collaborationSubmitButton.disabled = state === 'connected' || loading;
    if (state === 'disconnected' || state === 'reconnecting' || state === 'error') {
      lightingControls.cancel();
      lightingSession.pause();
      particleControls.cancel();
      particleSession.pause();
      for (const id of activeEdits.keys()) previews.end(id);
      activeEdits.clear();
      sceneControls.cancelTransformEdit();
      cancelLocalInputs();
      participants.clear();
      editLocks.clear();
      for (const entityId of serverEntities.keys()) updatePresence(entityId);
      renderParticipants();
      if (sceneControls.getSelectedEntity()) {
        sceneControls.setSelectedEntityEditable(true);
        syncSelectedEntity();
      }
    }
  }

  function renderParticipants() {
    if (participants.size === 0) {
      participantList.replaceChildren(Object.assign(document.createElement('li'), {
        textContent: collaborationConnected ? 'Você está sozinho nesta sala' : 'Nenhuma conexão ativa',
      }));
      return;
    }
    participantList.replaceChildren(...Array.from(participants.values(), (participant) => {
      const item = document.createElement('li');
      item.textContent = participant.id === collaborationClient?.connection.connectionId
        ? `${participant.name} (você)`
        : participant.name;
      return item;
    }));
  }

  function updatePresence(entityId) {
    const lock = editLocks.get(entityId);
    const lastEditor = serverEntities.get(entityId)?.lastEditor;
    sceneControls.setEntityPresence(entityId, lock?.participantName ?? null, lastEditor ?? null);
  }

  function showCollaborationMessage(text) {
    collaborationMessage.textContent = text;
  }

  function restoreServerEntity(entityId) {
    const authoritative = serverEntities.get(entityId);
    if (authoritative) {
      sceneControls.applySharedEntity(authoritative);
    }
  }

  async function publishCreation(entity) {
    inFlightUpdate = entity;
    try {
      const created = await collaborationClient.createEntity(entity);
      serverEntities.set(created.id, created);
      updatePresence(created.id);
    } finally {
      inFlightUpdate = null;
    }
  }

  async function processOperation(operation) {
    if (operation.isCurrent && !operation.isCurrent()) return;
    if (!collaborationClient?.connected) {
      if (operation.final !== false) pendingOperations.push(operation);
      return;
    }
    if (operation.kind === 'delete') {
      if (!serverEntities.has(operation.id)) return;
      const lock = await collaborationClient.acquireEditLock(operation.id);
      if (!lock.granted) {
        pendingOperations.push(operation);
        showCollaborationMessage(lock.reason ?? `Objeto bloqueado por ${lock.ownerName}.`);
        return;
      }
      try {
        await collaborationClient.deleteEntity(operation.id);
        serverEntities.delete(operation.id);
        sceneControls.removeSharedEntity(operation.id);
      } finally {
        if (collaborationClient.heldLocks.has(operation.id)) {
          await collaborationClient.releaseEditLock(operation.id);
        }
      }
      return;
    }

    const entity = operation.entity;
    const exists = serverEntities.has(entity.id);
    const known = serverEntities.get(entity.id);
    if (operation.final && sameEntityState(known, entity)) return;
    if (!exists) {
      if (operation.final === false || operation.expected) return;
      await publishCreation(entity);
      return;
    }

    const lock = await collaborationClient.acquireEditLock(entity.id);
    if (operation.isCurrent && !operation.isCurrent()) return;
    if (!lock.granted) {
      if (activeEdits.has(entity.id)) {
        sceneControls.cancelTransformEdit();
      }
      restoreServerEntity(entity.id);
      syncSelectedEntity();
      showCollaborationMessage(
        lock.ownerName
          ? `Esse objeto está sendo editado por ${lock.ownerName}.`
          : lock.reason ?? 'Não foi possível obter o bloqueio do objeto.',
      );
      return;
    }
    try {
      if (operation.replaying && !sameEntityState(serverEntities.get(entity.id), operation.replayExpected)) {
        showCollaborationMessage('O objeto mudou antes que a alteração pendente pudesse ser enviada.');
        return;
      }
      if (operation.final !== false) inFlightUpdate = entity;
      const updated = await collaborationClient.updateEntity(entity, operation.final !== false);
      if (operation.final !== false) {
        serverEntities.set(updated.id, updated);
        if (operation.replaying && !activeEdits.has(updated.id)) sceneControls.applySharedEntity(updated);
        updatePresence(updated.id);
      }
    } finally {
      inFlightUpdate = null;
      if (!activeEdits.has(entity.id) && !operation.transform && operation.final !== false) {
        await collaborationClient.releaseEditLock(entity.id);
      }
    }
  }

  function enqueueOperation(operation) {
    if (operation.kind === 'update' && operation.final) {
      operation.expected = serverEntities.get(operation.entity.id);
    }
    if (!collaborationConnected) {
      if (operation.final !== false) pendingOperations.push(operation);
      return Promise.resolve();
    }
    const task = operationQueue.then(() => processOperation(operation));
    operationQueue = task.catch((error) => {
      if (operation.final === false) return;
      if (!collaborationClient?.connected || operation.kind !== 'update') {
        pendingOperations.push(operation);
        showCollaborationMessage(`Alteração mantida localmente e aguardando envio: ${error.message}`);
      } else {
        restoreServerEntity(operation.entity.id);
        showCollaborationMessage(`Não foi possível confirmar a alteração: ${error.message}`);
      }
    });
    return operationQueue;
  }

  function publishEntity(entity, continuous = false) {
    if (!entity) return Promise.resolve();
    if (continuous) return previews.push(entity);
    return enqueueOperation({ kind: 'update', entity, final: true });
  }

  function flushPendingOperations() {
    operationQueue = operationQueue.then(async () => {
      const batch = pendingOperations.splice(0);
      const beforeReplay = new Map(serverEntities);
      for (let index = 0; index < batch.length; index += 1) {
        const operation = batch[index];
        if (operation.expected) {
          const current = beforeReplay.get(operation.entity.id);
          if (!sameEntityState(current, operation.expected) && !sameEntityState(current, operation.entity)) {
            showCollaborationMessage('Um objeto mudou na sala durante a desconexão. A versão compartilhada foi preservada.');
            continue;
          }
        }
        try {
          await processOperation({
            ...operation,
            transform: false,
            replaying: true,
            replayExpected: operation.entity && serverEntities.get(operation.entity.id),
          });
        } catch (error) {
          pendingOperations.unshift(...batch.slice(index));
          showCollaborationMessage(`Alterações aguardam sincronização: ${error.message}`);
          return;
        }
      }
    });
    return operationQueue;
  }

  function applyRoomSnapshot(snapshot) {
    if (snapshot.protocolVersion !== COLLABORATION_PROTOCOL_VERSION) {
      throw new Error('A sala usa uma versão de protocolo incompatível.');
    }
    cancelLocalInputs();
    serverEntities.clear();
    for (const entity of snapshot.entities) serverEntities.set(entity.id, entity);
    participants.clear();
    for (const participant of snapshot.participants) participants.set(participant.id, participant);
    editLocks.clear();
    for (const lock of snapshot.locks) editLocks.set(lock.entityId, lock);
    sceneControls.applySharedSnapshot(snapshot.entities);
    lightingControls.cancel();
    lightingSession.resume(snapshot.lighting);
    particleControls.cancel();
    particleSession.resume(snapshot.particles);
    for (const entity of snapshot.entities) updatePresence(entity.id);
    renderParticipants();
    void flushPendingOperations();
  }

  function createCollaborationClient() {
    if (collaborationClient) return collaborationClient;
    collaborationClient = new CollaborationClient({
      onStatus: setCollaborationStatus,
      onSnapshot: applyRoomSnapshot,
      onLighting: lightingSession.accept,
      onParticles: particleSession.accept,
      onParticipantJoined: (participant) => {
        participants.set(participant.id, participant);
        renderParticipants();
      },
      onParticipantLeft: (participantId) => {
        participants.delete(participantId);
        renderParticipants();
      },
      onEntityUpserted: (entity) => {
        serverEntities.set(entity.id, entity);
        const local = sceneControls.getEntity(entity.id);
        if (local && sameEntityState(inFlightUpdate, entity)) {
          local.lastEditor = entity.lastEditor ?? null;
        } else {
          cancelLocalInputs(entity.id);
          if (activeEdits.has(entity.id)) sceneControls.cancelTransformEdit();
          sceneControls.applySharedEntity(entity);
        }
        updatePresence(entity.id);
        renderEntityList();
        if (sceneControls.getSelectedEntity()?.id === entity.id) syncSelectedEntity();
      },
      onEntityDeleted: (entityId) => {
        cancelLocalInputs(entityId);
        serverEntities.delete(entityId);
        editLocks.delete(entityId);
        sceneControls.removeSharedEntity(entityId);
        renderEntityList();
      },
      onLockChanged: (lock) => {
        const ownLock = editLocks.get(lock.entityId)?.participantId === collaborationClient.connection.connectionId;
        if (!lock.participantId) {
          editLocks.delete(lock.entityId);
        } else {
          editLocks.set(lock.entityId, lock);
        }
        if (ownLock && lock.participantId !== collaborationClient.connection.connectionId &&
            activeEdits.has(lock.entityId)) {
          sceneControls.cancelTransformEdit();
        }
        updatePresence(lock.entityId);
        renderEntityList();
        syncSelectedEntity();
        if (!lock.participantId && pendingOperations.length > 0) {
          void flushPendingOperations().catch((error) => {
            showCollaborationMessage(`Alterações aguardam sincronização: ${error.message}`);
          });
        }
      },
      onLockLost: (entityId) => {
        if (activeEdits.has(entityId)) sceneControls.cancelTransformEdit();
        restoreServerEntity(entityId);
        if (sceneControls.getSelectedEntity()?.id === entityId) syncSelectedEntity();
        showCollaborationMessage('O bloqueio expirou; a última versão compartilhada foi restaurada.');
      },
      onTransportError: (error) => {
        showCollaborationMessage(`Falha ao renovar o bloqueio: ${error.message}`);
      },
    });
    return collaborationClient;
  }

  sceneControls.setCollaborationHandlers({
    onEntityCreated: (entity) => {
      if (entity.id !== '00000000-0000-4000-8000-000000000001') {
        enqueueOperation({ kind: 'create', entity });
      }
    },
    onEntityDeleted: (id) => enqueueOperation({ kind: 'delete', id }),
    onEntityChanged: (entity, { continuous }) => publishEntity(entity, continuous),
    onEditStateChange: (entityId, editing, finalEntity) => {
      if (editing) {
        const edit = {};
        activeEdits.set(entityId, edit);
        if (!collaborationConnected) return;
        previews.start(entityId);
        operationQueue = operationQueue.then(async () => {
          if (activeEdits.get(entityId) !== edit || !collaborationClient?.connected) return;
          const lock = await collaborationClient.acquireEditLock(entityId);
          if (!lock.granted) throw new Error(lock.reason ?? `Objeto bloqueado por ${lock.ownerName}.`);
        }).catch((error) => {
          if (activeEdits.get(entityId) !== edit) return;
          sceneControls.cancelTransformEdit();
          restoreServerEntity(entityId);
          syncSelectedEntity();
          showCollaborationMessage(error.message);
        });
        return;
      }

      previews.end(entityId);
      const edit = activeEdits.get(entityId);
      activeEdits.delete(entityId);
      if (!edit) return;
      if (finalEntity) {
        enqueueOperation({ kind: 'update', entity: finalEntity, final: true, transform: true });
      }
      operationQueue = operationQueue.then(async () => {
        if (!activeEdits.has(entityId) && collaborationClient?.connected &&
            collaborationClient.heldLocks.has(entityId)) {
          await collaborationClient.releaseEditLock(entityId);
        }
      }).catch((error) => {
        showCollaborationMessage(`Falha ao finalizar a edição: ${error.message}`);
      });
    },
  });

  sceneControls.setSelectionChangeHandler(() => {
    renderEntityList();
    syncSelectedEntity();
  });

  collaborationOpenButton.addEventListener('click', () => {
    if (!collaborationDialog.open) collaborationDialog.showModal();
    collaborationNameInput.focus();
  }, { signal });

  useLocalButton.addEventListener('click', () => {
    connectionAttemptId += 1;
    connectionAttemptInProgress = false;
    collaborationDialog.close();
    lightingSession.leave();
    particleSession.leave();
    setCollaborationStatus('disconnected', 'Colaboração desconectada · modo local');
    if (collaborationClient) {
      void collaborationClient.stop().catch((error) => {
        showCollaborationMessage(`Não foi possível encerrar a conexão: ${error.message}`);
      });
    }
  }, { signal });

  collaborationForm.addEventListener('submit', async (event) => {
    event.preventDefault();
    if (connectionAttemptInProgress) return;

    displayName = collaborationNameInput.value.trim();
    if (!displayName) {
      showCollaborationMessage('Informe um nome de exibição.');
      collaborationNameInput.focus();
      return;
    }

    connectionAttemptInProgress = true;
    const attemptId = ++connectionAttemptId;
    setCollaborationStatus('connecting', 'Conectando à sala...');
    showCollaborationMessage('');
    try {
      const client = createCollaborationClient();
      await client.connect(displayName, sceneControls.getSharedEntities());
      if (attemptId !== connectionAttemptId) return;
      collaborationDialog.close();
    } catch (error) {
      if (attemptId !== connectionAttemptId) return;
      console.warn('Não foi possível conectar à sala de colaboração.', error);
      setCollaborationStatus(
        'error',
        'Não foi possível conectar agora. Verifique a conexão e tente novamente.',
      );
      showCollaborationMessage(
        'A colaboração está indisponível no momento. Suas alterações permanecem neste navegador.',
      );
    } finally {
      if (attemptId === connectionAttemptId) {
        connectionAttemptInProgress = false;
        if (collaborationClient?.connected) {
          setCollaborationStatus(
            'connected',
            `Conectado à sala ${collaborationClient.lastSnapshot?.roomId ?? ''}`.trim(),
          );
        }
      }
    }
  }, { signal });

  window.addEventListener('pagehide', (event) => {
    if (!event.persisted) disposePage();
  }, { signal });

  if (!collaborationDialog.open) collaborationDialog.showModal();

} catch (error) {
  pageLifetime.abort();
  disposePage?.();
  console.error('Não foi possível inicializar o WebGL.', error);
  message.hidden = false;
  container.classList.add('scene-container--unsupported');
  document.querySelectorAll('button, input').forEach((control) => {
    control.disabled = true;
  });
}
