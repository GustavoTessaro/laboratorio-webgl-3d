import './style.css';
import { createScene } from './scene.js';
import { CollaborationClient, COLLABORATION_PROTOCOL_VERSION } from './collaboration.js';
import { sameGeometryParameters } from './graphics/geometries.js';
import { sameMaterialSettings } from './graphics/object-materials.js';
import { createTransformPreviews } from './edit-gestures.js';
import { createEntityEditJournal, deliverEntityEdit } from './entity-edit-queue.js';
import { createControlsPanel } from './controls-panel.js';
import { bindLightingControls } from './lighting-controls.js';
import { createLightingSession } from './lighting-session.js';
import { createRoomSettingsSession } from './room-settings-session.js';
import { bindParticleControls } from './particle-controls.js';
import { bindInspectorControls } from './inspector-controls.js';
import { bindEnvironmentControls } from './environment-controls.js';
import { ENVIRONMENT_VERSION, prepareEnvironment } from './graphics/environment-presets.js';
import { sameTrajectory } from './graphics/trajectory-settings.js';
import { changeParticles, EMPTY_PARTICLES, sameParticleSettings } from './graphics/particle-settings.js';
import { createModelLibrary } from './graphics/model-assets.js';
import { isCatalogModel, modelCatalog, PRIVATE_MODEL } from './graphics/model-settings.js';
import { bindModelControls } from './model-controls.js';

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
    sameTrajectory(first.trajectory, second.trajectory) &&
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
  const modelLibrary = createModelLibrary();
  const sceneControls = createScene(container, { models: modelLibrary });
  disposePage = sceneControls.dispose;
  const serverEntities = new Map();
  const participants = new Map();
  const editLocks = new Map();
  const pendingOperations = [];
  const activeEdits = new Map();
  const editJournal = createEntityEditJournal(sameEntityState);
  const retryTimers = new Map();
  const previews = createTransformPreviews((entity, isCurrent) => {
    const before = activeEdits.get(entity.id)?.before;
    if (before) enqueueOperation({ kind: 'update', entity, before, final: false, isCurrent });
  });
  let collaborationClient = null;
  let collaborationConnected = false;
  let operationQueue = Promise.resolve();
  let displayName = '';
  let connectionAttemptInProgress = false;
  let connectionAttemptId = 0;
  let unresolvedEnvironment = null;

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
  const allowsPrivate = () => !connectionAttemptInProgress && !collaborationConnected && !lightingSession.shared;
  const modelControls = bindModelControls(document.querySelector('[data-model-import]'), {
    scene: sceneControls, library: modelLibrary, allowsPrivate,
  }, signal);
  bindInspectorControls(document.querySelector('[data-graphics-inspector]'), sceneControls.inspector, signal);
  bindEnvironmentControls(document.querySelector('[data-environments]'), {
    load: loadEnvironment,
    frame(preset, ids) {
      sceneControls.setCameraPreset(preset.camera);
      if (ids.length) sceneControls.frameEntities(ids);
      else sceneControls.frameAll();
    },
  }, signal);

  function applyEnvironmentChange(change, shared) {
    const replace = change.mode === 'replace';
    if (replace) {
      modelControls.cancel('Carregamento cancelado pela troca de cena.');
      cancelLocalInputs();
      lightingControls.cancel();
      particleControls.cancel();
    }
    sceneControls.applyEnvironmentEntities(change.entities, replace);
    if (shared) {
      if (replace) {
        serverEntities.clear();
        editLocks.clear();
      }
      for (const entity of change.entities) serverEntities.set(entity.id, entity);
      lightingSession.accept(change.lighting);
      particleSession.accept(change.particles);
    } else {
      if (replace) lightingSession.replaceLocal(change.lighting);
      particleSession.replaceLocal(change.particles, !replace);
    }
    renderEntityList();
    syncSelectedEntity();
  }

  async function loadEnvironment(preset, mode) {
    const client = collaborationClient;
    if (connectionAttemptInProgress || (lightingSession.shared && !client?.connected)) {
      throw new Error('Reconecte à sala ou escolha continuar no modo local.');
    }
    if (mode === 'replace' && (activeEdits.size || lightingSession.pending || particleSession.pending)) {
      throw new Error('Conclua as edições em andamento antes de substituir a cena.');
    }
    if (!client?.connected) {
      const change = prepareEnvironment(preset.id, mode, {
        entities: sceneControls.getEntities(),
        lighting: lightingSession.confirmed,
        particles: particleSession.confirmed,
      });
      applyEnvironmentChange(change, false);
      return change.entities.map(({ id }) => id);
    }

    const command = unresolvedEnvironment?.environmentId === preset.id && unresolvedEnvironment.mode === mode
      ? unresolvedEnvironment
      : { environmentId: preset.id, mode, operationId: crypto.randomUUID(), catalogVersion: ENVIRONMENT_VERSION };
    if (unresolvedEnvironment && unresolvedEnvironment !== command) {
      throw new Error('Confirme primeiro a tentativa anterior usando o mesmo ambiente e modo.');
    }
    await operationQueue;
    if (pendingOperations.length || activeEdits.size) {
      throw new Error('Conclua a sincronização das edições antes de aplicar um ambiente.');
    }
    unresolvedEnvironment = command;
    try {
      const ids = await client.applyEnvironment(command);
      unresolvedEnvironment = null;
      return ids;
    } catch (error) {
      if (client.connected && error.message.includes('Ambiente rejeitado.')) {
        unresolvedEnvironment = null;
        throw error;
      }
      throw new Error('A confirmação do ambiente está pendente. Após reconectar, repita o mesmo ambiente e modo.');
    }
  }

  disposePage = () => {
    pageLifetime.abort();
    for (const id of activeEdits.keys()) previews.end(id);
    activeEdits.clear();
    for (const timer of retryTimers.values()) clearTimeout(timer);
    retryTimers.clear();
    editJournal.clear();
    lightingSession.leave();
    particleSession.leave();
    panel.dispose();
    sceneControls.dispose();
    modelLibrary.dispose();
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
      for (const entityId of serverEntities.keys()) {
        sceneControls.clearRemoteTransformPreview(entityId);
        updatePresence(entityId);
      }
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

  function restoreServerEntity(entityId, refresh = true) {
    if (signal.aborted) return;
    const authoritative = serverEntities.get(entityId);
    if (!authoritative || activeEdits.has(entityId)) return;
    sceneControls.clearRemoteTransformPreview(entityId);
    const visible = editJournal.project(authoritative);
    if (!sameEntityState(sceneControls.serializeEntity(entityId), visible)) {
      cancelLocalInputs(entityId);
      sceneControls.applySharedEntity(visible);
    }
    const local = sceneControls.getEntity(entityId);
    if (local) local.lastEditor = authoritative.lastEditor ?? null;
    updatePresence(entityId);
    if (refresh) {
      renderEntityList();
      if (sceneControls.getSelectedEntity()?.id === entityId) syncSelectedEntity();
    }
  }

  function deferOperation(operation) {
    if (!pendingOperations.includes(operation)) pendingOperations.push(operation);
  }

  function finishEdit(operation) {
    if (!operation.final) return;
    clearTimeout(retryTimers.get(operation));
    retryTimers.delete(operation);
    editJournal.finish(operation);
    restoreServerEntity(operation.entity.id);
    if (pendingOperations.length && collaborationClient?.connected) void flushPendingOperations();
  }

  async function processEdit(operation) {
    const { entity, final } = operation;
    const client = collaborationClient;
    if (final && editJournal.hasEarlier(operation)) {
      deferOperation(operation);
      return;
    }
    const connectionId = client?.connection.connectionId;
    const sameConnection = () => client?.connected && client.connection.connectionId === connectionId;
    try {
      const result = await deliverEntityEdit(client, operation, (id) => serverEntities.has(id));
      if (!final) return;
      if (result.status === 'offline' || (result.status === 'locked' && result.lock.ownerName)) {
        deferOperation(operation);
        if (result.lock) showCollaborationMessage(`Edição aguardando o bloqueio de ${result.lock.ownerName}.`);
        return;
      }
      if (result.status === 'removed' || !serverEntities.has(entity.id)) {
        showCollaborationMessage('A edição pendente foi descartada porque o objeto foi removido ou a sala foi substituída.');
      } else if (result.status === 'locked') {
        showCollaborationMessage(result.lock.reason ?? 'Não foi possível obter o bloqueio do objeto.');
      }
      finishEdit(operation);
    } catch (error) {
      if (!final || signal.aborted) return;
      if (!sameConnection() || !error.message.includes('Edição rejeitada.')) {
        deferOperation(operation);
        showCollaborationMessage('Confirmação pendente. A edição será verificada com o servidor.');
        if (sameConnection() && !retryTimers.has(operation)) {
          const retry = operation.retryCount ?? 0;
          if (retry < 4) {
            operation.retryCount = retry + 1;
            retryTimers.set(operation, setTimeout(() => {
              retryTimers.delete(operation);
              if (!signal.aborted && collaborationClient?.connected) void flushPendingOperations();
            }, 1000 * 2 ** retry));
          }
        }
      } else {
        finishEdit(operation);
        showCollaborationMessage(error.message.slice(error.message.indexOf('Edição rejeitada.')));
      }
    } finally {
      if (sameConnection() && !activeEdits.has(entity.id) && client.heldLocks.has(entity.id)) {
        try { await client.releaseEditLock(entity.id); }
        catch (error) { showCollaborationMessage(`Falha ao liberar o bloqueio: ${error.message}`); }
      }
    }
  }

  async function processOperation(operation) {
    if (operation.kind === 'update') return processEdit(operation);
    if (operation.isCurrent && !operation.isCurrent()) return;
    if (!collaborationClient?.connected) {
      if (operation.final !== false) deferOperation(operation);
      return;
    }
    if (operation.kind === 'delete') {
      if (!serverEntities.has(operation.id)) return;
      const lock = await collaborationClient.acquireEditLock(operation.id);
      if (!lock.granted) {
        deferOperation(operation);
        showCollaborationMessage(lock.reason ?? `Objeto bloqueado por ${lock.ownerName}.`);
        return;
      }
      try {
        await collaborationClient.deleteEntity(operation.id);
      } finally {
        if (collaborationClient.heldLocks.has(operation.id)) {
          await collaborationClient.releaseEditLock(operation.id);
        }
      }
      return;
    }

    if (!serverEntities.has(operation.entity.id)) await collaborationClient.createEntity(operation.entity);
  }

  function enqueueOperation(operation) {
    if (operation.entity?.type === PRIVATE_MODEL || sceneControls.getEntity(operation.id)?.privateModel) {
      return Promise.resolve();
    }
    if (operation.kind === 'update' && operation.final) {
      if (!operation.before || sameEntityState(operation.before, operation.entity)) return Promise.resolve();
      editJournal.track(operation);
    }
    if (!collaborationConnected) {
      if (operation.final !== false) deferOperation(operation);
      return Promise.resolve();
    }
    const task = operationQueue.then(() => processOperation(operation));
    operationQueue = task.catch((error) => {
      if (operation.final === false) return;
      if (operation.kind === 'create' && isCatalogModel(operation.entity.type) &&
          collaborationClient?.connected && error.message.includes('Modelo rejeitado.')) {
        sceneControls.removeSharedEntity(operation.entity.id);
        showCollaborationMessage(error.message);
        return;
      }
      if (!collaborationClient?.connected || operation.kind !== 'update') {
        deferOperation(operation);
        showCollaborationMessage(`Alteração mantida localmente e aguardando envio: ${error.message}`);
      } else {
        restoreServerEntity(operation.entity.id);
        showCollaborationMessage(`Não foi possível confirmar a alteração: ${error.message}`);
      }
    });
    return operationQueue;
  }

  function publishEntity(entity, { continuous, before }) {
    if (!entity) return Promise.resolve();
    if (continuous) return previews.push(entity);
    return enqueueOperation({ kind: 'update', entity, before, final: true });
  }

  function flushPendingOperations() {
    operationQueue = operationQueue.then(async () => {
      const batch = pendingOperations.splice(0);
      for (let index = 0; index < batch.length; index += 1) {
        const operation = batch[index];
        if (retryTimers.has(operation)) {
          deferOperation(operation);
          continue;
        }
        try {
          await processOperation(operation);
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
    modelControls.cancel('Carregamento cancelado pela sincronização da cena.');
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
    for (const entity of snapshot.entities) restoreServerEntity(entity.id, false);
    renderEntityList();
    syncSelectedEntity();
    renderParticipants();
    void flushPendingOperations();
  }

  function createCollaborationClient() {
    if (collaborationClient) return collaborationClient;
    collaborationClient = new CollaborationClient({
      onStatus: setCollaborationStatus,
      onSnapshot: applyRoomSnapshot,
      onEnvironment: (change) => applyEnvironmentChange(change, true),
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
        restoreServerEntity(entity.id);
      },
      onEntityPreviewed: (entity) => {
        if (serverEntities.has(entity.id) && !activeEdits.has(entity.id)) sceneControls.applyRemoteTransformPreview(entity);
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
          sceneControls.clearRemoteTransformPreview(lock.entityId);
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
    onEntityChanged: publishEntity,
    onEditStateChange: (entityId, editing, finalEntity) => {
      if (sceneControls.getEntity(entityId)?.privateModel) return;
      if (editing) {
        const edit = { before: sceneControls.serializeEntity(entityId) };
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
        enqueueOperation({ kind: 'update', entity: finalEntity, before: edit.before, final: true });
      }
      restoreServerEntity(entityId);
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
    modelControls.sync(sceneControls.getSelectedEntity());
  });

  collaborationOpenButton.addEventListener('click', () => {
    if (!collaborationDialog.open) collaborationDialog.showModal();
    collaborationNameInput.focus();
  }, { signal });

  useLocalButton.addEventListener('click', () => {
    unresolvedEnvironment = null;
    connectionAttemptId += 1;
    connectionAttemptInProgress = false;
    collaborationDialog.close();
    lightingSession.leave();
    particleSession.leave();
    setCollaborationStatus('disconnected', 'Colaboração desconectada · modo local');
    modelControls.setParked(sceneControls.setPrivateModelsVisible(true));
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
    modelControls.cancel('Carregamento cancelado ao conectar à sala.');
    modelControls.setParked(sceneControls.setPrivateModelsVisible(false));
    const attemptId = ++connectionAttemptId;
    setCollaborationStatus('connecting', 'Conectando à sala...');
    showCollaborationMessage('');
    try {
      await Promise.all(Object.keys(modelCatalog).map((type) => modelLibrary.load(type)));
      if (attemptId !== connectionAttemptId || signal.aborted) return;
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
        if (allowsPrivate()) modelControls.setParked(sceneControls.setPrivateModelsVisible(true));
        else modelControls.sync();
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
