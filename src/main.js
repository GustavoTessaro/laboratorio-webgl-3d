import './style.css';
import { createScene } from './scene.js';
import { CollaborationClient } from './collaboration.js';

const container = document.querySelector('#scene-container');
const message = document.querySelector('#webgl-message');
const addObjectButtons = document.querySelectorAll('[data-add-object]');
const sceneObjectList = document.querySelector('#scene-object-list');
const duplicateObjectButton = document.querySelector('[data-duplicate-object]');
const deleteObjectButton = document.querySelector('[data-delete-object]');
const copyPropertiesButton = document.querySelector('[data-copy-properties]');
const applyPropertiesButton = document.querySelector('[data-apply-properties]');
const objectActionMessage = document.querySelector('#object-action-message');
const transformModeButtons = document.querySelectorAll('[data-transform-mode]');
const objectButtons = document.querySelectorAll('[data-object-shape]');
const colorButtons = document.querySelectorAll('[data-object-color]');
const materialButtons = document.querySelectorAll('[data-material-mode]');
const customColorInput = document.querySelector('#custom-object-color');
const resetAppearanceButton = document.querySelector('[data-reset-appearance]');
const lightingInputs = {
  ambientIntensity: document.querySelector('#ambient-intensity'),
  directionalIntensity: document.querySelector('#directional-intensity'),
  directionalX: document.querySelector('#directional-x'),
  directionalY: document.querySelector('#directional-y'),
};
const lightingOutputs = {
  ambientIntensity: document.querySelector('#ambient-intensity-value'),
  directionalIntensity: document.querySelector('#directional-intensity-value'),
  directionalX: document.querySelector('#directional-x-value'),
  directionalY: document.querySelector('#directional-y-value'),
};
const resetLightingButton = document.querySelector('[data-reset-lighting]');
const rotationToggleButton = document.querySelector('[data-toggle-rotation]');
const rotationStatus = document.querySelector('[data-animation-status]');
const rotationSpeedInput = document.querySelector('#rotation-speed');
const rotationSpeedOutput = document.querySelector('#rotation-speed-value');
const rotationAxisButtons = document.querySelectorAll('[data-rotation-axis]');
const resetOrientationButton = document.querySelector('[data-reset-orientation]');
const collaborationStatus = document.querySelector('#collaboration-status');
const collaborationOpenButton = document.querySelector('#collaboration-open');
const collaborationDialog = document.querySelector('#collaboration-dialog');
const collaborationForm = document.querySelector('#collaboration-form');
const collaborationSubmitButton = collaborationForm.querySelector('[type="submit"]');
const collaborationNameInput = document.querySelector('#collaboration-name');
const collaborationMessage = document.querySelector('#collaboration-message');
const participantList = document.querySelector('#participant-list');
const useLocalButton = document.querySelector('[data-collaboration-local]');

try {
  const sceneControls = createScene(container);
  const serverEntities = new Map();
  const participants = new Map();
  const editLocks = new Map();
  const pendingOperations = [];
  const activeEdits = new Set();
  const deniedEdits = new Set();
  const pendingContinuousUpdates = new Map();
  const continuousTimers = new Map();
  let collaborationClient = null;
  let collaborationConnected = false;
  let operationQueue = Promise.resolve();
  let displayName = '';
  let connectionAttemptInProgress = false;
  let connectionAttemptId = 0;

  function setCollaborationStatus(state, text) {
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
      participants.clear();
      editLocks.clear();
      deniedEdits.clear();
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

  async function processOperation(operation) {
    if (!collaborationClient?.connected) {
      pendingOperations.push(operation);
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
      await collaborationClient.deleteEntity(operation.id);
      serverEntities.delete(operation.id);
      return;
    }

    const entity = operation.entity;
    if (deniedEdits.has(entity.id)) return;
    const exists = serverEntities.has(entity.id);
    if (operation.kind === 'create' && !exists) {
      const created = await collaborationClient.createEntity(entity);
      serverEntities.set(created.id, created);
      updatePresence(created.id);
      return;
    }

    if (!exists) {
      const created = await collaborationClient.createEntity(entity);
      serverEntities.set(created.id, created);
      updatePresence(created.id);
      return;
    }

    const lock = await collaborationClient.acquireEditLock(entity.id);
    if (!lock.granted) {
      if (activeEdits.has(entity.id)) deniedEdits.add(entity.id);
      restoreServerEntity(entity.id);
      showCollaborationMessage(
        lock.ownerName
          ? `Esse objeto está sendo editado por ${lock.ownerName}.`
          : lock.reason ?? 'Não foi possível obter o bloqueio do objeto.',
      );
      return;
    }
    try {
      const updated = await collaborationClient.updateEntity(entity, operation.final !== false);
      serverEntities.set(updated.id, updated);
      updatePresence(updated.id);
    } finally {
      if (!activeEdits.has(entity.id)) await collaborationClient.releaseEditLock(entity.id);
    }
  }

  function enqueueOperation(operation) {
    if (!collaborationConnected) {
      pendingOperations.push(operation);
      return Promise.resolve();
    }
    const task = operationQueue.then(() => processOperation(operation));
    operationQueue = task.catch((error) => {
      pendingOperations.push(operation);
      showCollaborationMessage(`Alteração mantida localmente e aguardando envio: ${error.message}`);
    });
    return operationQueue;
  }

  function publishEntity(entity, continuous = false) {
    if (!entity) return Promise.resolve();
    if (!continuous) {
      const timer = continuousTimers.get(entity.id);
      if (timer) window.clearTimeout(timer);
      continuousTimers.delete(entity.id);
      pendingContinuousUpdates.delete(entity.id);
      return enqueueOperation({ kind: 'update', entity, final: true });
    }

    pendingContinuousUpdates.set(entity.id, entity);
    if (continuousTimers.has(entity.id)) return Promise.resolve();
    continuousTimers.set(entity.id, window.setTimeout(() => {
      continuousTimers.delete(entity.id);
      const latest = pendingContinuousUpdates.get(entity.id);
      pendingContinuousUpdates.delete(entity.id);
      if (latest) enqueueOperation({ kind: 'update', entity: latest, final: false });
    }, 100));
    return Promise.resolve();
  }

  async function flushPendingOperations() {
    const batch = pendingOperations.splice(0);
    for (let index = 0; index < batch.length; index += 1) {
      try {
        await processOperation(batch[index]);
      } catch (error) {
        pendingOperations.unshift(...batch.slice(index));
        showCollaborationMessage(`Alterações aguardam sincronização: ${error.message}`);
        return;
      }
    }
  }

  function applyRoomSnapshot(snapshot) {
    if (snapshot.protocolVersion !== 1) {
      throw new Error('A sala usa uma versão de protocolo incompatível.');
    }
    serverEntities.clear();
    for (const entity of snapshot.entities) serverEntities.set(entity.id, entity);
    participants.clear();
    for (const participant of snapshot.participants) participants.set(participant.id, participant);
    editLocks.clear();
    for (const lock of snapshot.locks) editLocks.set(lock.entityId, lock);
    sceneControls.applySharedSnapshot(snapshot.entities);
    for (const entity of snapshot.entities) updatePresence(entity.id);
    renderParticipants();
    void flushPendingOperations();
  }

  function createCollaborationClient() {
    if (collaborationClient) return collaborationClient;
    collaborationClient = new CollaborationClient({
      onStatus: setCollaborationStatus,
      onSnapshot: applyRoomSnapshot,
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
        sceneControls.applySharedEntity(entity);
        updatePresence(entity.id);
        renderEntityList();
        if (sceneControls.getSelectedEntity()?.id === entity.id) syncSelectedEntity();
      },
      onEntityDeleted: (entityId) => {
        serverEntities.delete(entityId);
        editLocks.delete(entityId);
        sceneControls.removeSharedEntity(entityId);
        renderEntityList();
      },
      onLockChanged: (lock) => {
        if (!lock.participantId) {
          editLocks.delete(lock.entityId);
          if (!activeEdits.has(lock.entityId)) deniedEdits.delete(lock.entityId);
        } else {
          editLocks.set(lock.entityId, lock);
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
        activeEdits.delete(entityId);
        deniedEdits.add(entityId);
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
    onEditStateChange: async (entityId, editing, finalEntity) => {
      if (editing) {
        activeEdits.add(entityId);
        deniedEdits.delete(entityId);
        if (!collaborationConnected) return;
        let lock;
        try {
          lock = await collaborationClient.acquireEditLock(entityId);
        } catch (error) {
          deniedEdits.add(entityId);
          activeEdits.delete(entityId);
          restoreServerEntity(entityId);
          if (sceneControls.getSelectedEntity()?.id === entityId) syncSelectedEntity();
          showCollaborationMessage(`Não foi possível bloquear o objeto: ${error.message}`);
          return;
        }
        if (!lock.granted) {
          deniedEdits.add(entityId);
          activeEdits.delete(entityId);
          restoreServerEntity(entityId);
          if (sceneControls.getSelectedEntity()?.id === entityId) syncSelectedEntity();
          showCollaborationMessage(
            lock.ownerName
              ? `Esse objeto está sendo editado por ${lock.ownerName}.`
              : lock.reason ?? 'Não foi possível obter o bloqueio do objeto.',
          );
        }
        return;
      }

      if (deniedEdits.has(entityId)) {
        restoreServerEntity(entityId);
        deniedEdits.delete(entityId);
        activeEdits.delete(entityId);
        if (sceneControls.getSelectedEntity()?.id === entityId) syncSelectedEntity();
        return;
      }
      try {
        if (finalEntity) await publishEntity(finalEntity, false);
        activeEdits.delete(entityId);
        if (collaborationConnected) await collaborationClient.releaseEditLock(entityId);
      } catch (error) {
        activeEdits.delete(entityId);
        showCollaborationMessage(`Falha ao finalizar a edição: ${error.message}`);
      }
    },
  });

  function updateColorSelection(color) {
    const normalizedColor = color.toLowerCase();
    colorButtons.forEach((button) => {
      button.setAttribute(
        'aria-pressed',
        String(button.dataset.objectColor.toLowerCase() === normalizedColor),
      );
    });
    customColorInput.value = normalizedColor;
  }

  function updateObjectListSelection() {
    const selectedId = sceneControls.getSelectedEntity()?.id;
    sceneObjectList.querySelectorAll('[data-entity-id]').forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.entityId === selectedId));
    });
  }

  function syncSelectedEntity() {
    const entity = sceneControls.getSelectedEntity();
    const hasSelection = Boolean(entity);
    const selectedLock = entity ? editLocks.get(entity.id) : null;
    const lockedByAnotherParticipant = Boolean(
      selectedLock &&
      selectedLock.participantId !== collaborationClient?.connection.connectionId,
    ) || Boolean(entity && deniedEdits.has(entity.id));
    sceneControls.setSelectedEntityEditable(!lockedByAnotherParticipant);
    const selectionDependentControls = [
      ...objectButtons,
      ...colorButtons,
      customColorInput,
      ...materialButtons,
      resetAppearanceButton,
      rotationToggleButton,
      rotationSpeedInput,
      ...rotationAxisButtons,
      resetOrientationButton,
    ];
    selectionDependentControls.forEach((control) => {
      control.disabled = !hasSelection || lockedByAnotherParticipant;
    });
    duplicateObjectButton.disabled = !hasSelection || lockedByAnotherParticipant;
    deleteObjectButton.disabled = !hasSelection || lockedByAnotherParticipant;
    copyPropertiesButton.disabled = !hasSelection || lockedByAnotherParticipant;
    applyPropertiesButton.disabled = !hasSelection ||
      lockedByAnotherParticipant ||
      !sceneControls.hasCopiedProperties();
    transformModeButtons.forEach((button) => {
      button.disabled = lockedByAnotherParticipant;
    });
    updateObjectListSelection();
    if (!entity) {
      [...objectButtons, ...colorButtons, ...materialButtons, ...rotationAxisButtons].forEach((button) => {
        button.setAttribute('aria-pressed', 'false');
      });
      customColorInput.value = '#6c8cff';
      rotationToggleButton.setAttribute('aria-pressed', 'false');
      rotationToggleButton.textContent = 'Iniciar rotação';
      rotationSpeedInput.value = '45';
      rotationSpeedOutput.value = '45°/s';
      rotationStatus.textContent = 'Nenhum objeto selecionado';
      return;
    }

    objectButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.objectShape === entity.type));
    });
    updateColorSelection(entity.color);
    materialButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(
        button.dataset.materialMode === entity.materialMode,
      ));
    });
    rotationToggleButton.setAttribute('aria-pressed', String(entity.animation.enabled));
    rotationToggleButton.textContent = entity.animation.enabled
      ? 'Pausar rotação'
      : 'Iniciar rotação';
    rotationStatus.textContent = entity.animation.enabled
      ? 'Animação ativa'
      : 'Animação pausada';
    rotationSpeedInput.value = String(entity.animation.speed);
    rotationSpeedOutput.value = `${entity.animation.speed}°/s`;
    rotationAxisButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.rotationAxis === entity.animation.axis));
    });
  }

  function renderEntityList() {
    const items = sceneControls.getEntities().map((entity) => {
      const item = document.createElement('div');
      item.className = 'scene-object-item';
      item.setAttribute('role', 'listitem');

      const button = document.createElement('button');
      button.className = 'scene-object-option';
      button.type = 'button';
      button.dataset.entityId = entity.id;
      const lock = editLocks.get(entity.id);
      button.textContent = lock
        ? `${entity.name} · ${lock.participantName}`
        : entity.lastEditor
          ? `${entity.name} · ${entity.lastEditor}`
          : entity.name;
      button.title = lock
        ? `Editando: ${lock.participantName}`
        : entity.lastEditor
          ? `Última edição: ${entity.lastEditor}`
          : entity.name;
      button.setAttribute('aria-pressed', 'false');
      button.addEventListener('click', () => {
        sceneControls.selectEntity(entity.id);
      });
      item.append(button);
      return item;
    });
    sceneObjectList.replaceChildren(...items);
    updateObjectListSelection();
  }

  sceneControls.setSelectionChangeHandler(() => {
    renderEntityList();
    syncSelectedEntity();
  });

  collaborationOpenButton.addEventListener('click', () => {
    if (!collaborationDialog.open) collaborationDialog.showModal();
    collaborationNameInput.focus();
  });

  useLocalButton.addEventListener('click', () => {
    connectionAttemptId += 1;
    connectionAttemptInProgress = false;
    collaborationDialog.close();
    setCollaborationStatus('disconnected', 'Colaboração desconectada · modo local');
    if (collaborationClient) {
      void collaborationClient.stop().catch((error) => {
        showCollaborationMessage(`Não foi possível encerrar a conexão: ${error.message}`);
      });
    }
  });

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
  });

  transformModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('aria-pressed') === 'true'
        ? null
        : button.dataset.transformMode;
      sceneControls.setTransformMode(mode);
      transformModeButtons.forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button && mode !== null));
      });
    });
  });

  duplicateObjectButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity) return;

    const duplicate = sceneControls.duplicateEntity(entity.id);
    objectActionMessage.hidden = Boolean(duplicate);
    objectActionMessage.textContent = duplicate
      ? ''
      : 'Não foi possível duplicar: não há uma posição válida dentro dos limites.';
  });

  deleteObjectButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity) return;
    objectActionMessage.hidden = true;
    objectActionMessage.textContent = '';
    if (!collaborationConnected) {
      sceneControls.removeEntity(entity.id);
      return;
    }

    void (async () => {
      try {
        const lock = await collaborationClient.acquireEditLock(entity.id);
        if (!lock.granted) {
          showCollaborationMessage(lock.reason ?? `Objeto bloqueado por ${lock.ownerName}.`);
          return;
        }
        await collaborationClient.deleteEntity(entity.id);
        serverEntities.delete(entity.id);
        sceneControls.removeSharedEntity(entity.id);
      } catch (error) {
        showCollaborationMessage(`Não foi possível excluir o objeto: ${error.message}`);
      } finally {
        try {
          if (collaborationClient.heldLocks.has(entity.id)) {
            await collaborationClient.releaseEditLock(entity.id);
          }
        } catch (error) {
          showCollaborationMessage(`Falha ao liberar o bloqueio: ${error.message}`);
        }
      }
    })();
  });

  copyPropertiesButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity) return;
    sceneControls.copyEntityProperties(entity.id);
    applyPropertiesButton.disabled = false;
    objectActionMessage.hidden = true;
    objectActionMessage.textContent = '';
  });

  applyPropertiesButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity || !sceneControls.hasCopiedProperties()) return;
    sceneControls.applyCopiedProperties(entity.id);
  });

  addObjectButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sceneControls.createEntity(button.dataset.addObject);
    });
  });

  objectButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sceneControls.selectObject(button.dataset.objectShape);
    });
  });

  colorButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { objectColor } = button.dataset;
      sceneControls.setColor(objectColor);
      syncSelectedEntity();
    });
  });

  customColorInput.addEventListener('input', () => {
    sceneControls.setColor(customColorInput.value);
    syncSelectedEntity();
  });

  materialButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { materialMode } = button.dataset;
      sceneControls.setWireframe(materialMode === 'wireframe');
      syncSelectedEntity();
    });
  });

  resetAppearanceButton.addEventListener('click', () => {
    sceneControls.resetAppearance();
    syncSelectedEntity();
  });

  const lightingSetters = {
    ambientIntensity: sceneControls.setAmbientIntensity,
    directionalIntensity: sceneControls.setDirectionalIntensity,
    directionalX: sceneControls.setDirectionalX,
    directionalY: sceneControls.setDirectionalY,
  };

  Object.entries(lightingInputs).forEach(([key, input]) => {
    input.addEventListener('input', () => {
      const value = Number(input.value);
      lightingSetters[key](value);
      lightingOutputs[key].value = value.toFixed(1).replace('.', ',');
    });
  });

  resetLightingButton.addEventListener('click', () => {
    const defaults = sceneControls.resetLighting();
    Object.entries(defaults).forEach(([key, value]) => {
      lightingInputs[key].value = String(value);
      lightingOutputs[key].value = value.toFixed(1).replace('.', ',');
    });
  });

  rotationToggleButton.addEventListener('click', () => {
    sceneControls.toggleRotation();
    syncSelectedEntity();
  });

  rotationSpeedInput.addEventListener('input', () => {
    const degreesPerSecond = Number(rotationSpeedInput.value);
    sceneControls.setRotationSpeed(degreesPerSecond);
    rotationSpeedOutput.value = `${degreesPerSecond}°/s`;
  });

  rotationAxisButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sceneControls.setRotationAxis(button.dataset.rotationAxis);
      syncSelectedEntity();
    });
  });

  resetOrientationButton.addEventListener('click', () => {
    sceneControls.resetOrientation();
  });

  if (!collaborationDialog.open) collaborationDialog.showModal();

} catch (error) {
  console.error('Não foi possível inicializar o WebGL.', error);
  message.hidden = false;
  container.classList.add('scene-container--unsupported');
  document.querySelectorAll('button, input').forEach((control) => {
    control.disabled = true;
  });
}
