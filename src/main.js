import './style.css';
import { createScene } from './scene.js';
import { CollaborationClient } from './collaboration.js';
import { bindLocalInput, createTransformPreviews } from './edit-gestures.js';

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

function sameEntityState(first, second) {
  if (!first || !second) return first === second;
  return ['id', 'name', 'type', 'color', 'materialMode'].every((key) => first[key] === second[key]) &&
    ['position', 'rotation', 'scale'].every((key) =>
      ['x', 'y', 'z'].every((axis) => first[key][axis] === second[key][axis]),
    ) &&
    ['enabled', 'axis', 'speed'].every((key) => first.animation[key] === second.animation[key]);
}

try {
  const sceneControls = createScene(container);
  const serverEntities = new Map();
  const participants = new Map();
  const editLocks = new Map();
  const pendingOperations = [];
  const activeEdits = new Map();
  const localInputs = [];
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

  function cancelLocalInputs(entityId) {
    for (const input of localInputs) {
      if (entityId === undefined || input.entity?.id === entityId) input.cancel();
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
    if (operation.kind === 'create' && !exists) {
      const created = await collaborationClient.createEntity(entity);
      serverEntities.set(created.id, created);
      updatePresence(created.id);
      return;
    }

    if (!exists) {
      if (operation.final === false || operation.expected) return;
      const created = await collaborationClient.createEntity(entity);
      serverEntities.set(created.id, created);
      updatePresence(created.id);
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
    if (snapshot.protocolVersion !== 1) {
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
        if (!sameEntityState(inFlightUpdate, entity)) {
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
    );
    for (const input of localInputs) {
      if (input.entity && (input.entity !== entity || lockedByAnotherParticipant)) input.cancel();
    }
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
    if (!localInputs[0]?.entity) updateColorSelection(entity.color);
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
    if (!localInputs[1]?.entity) {
      rotationSpeedInput.value = String(entity.animation.speed);
      rotationSpeedOutput.value = `${entity.animation.speed}°/s`;
    }
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

    enqueueOperation({ kind: 'delete', id: entity.id });
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

  localInputs.push(bindLocalInput(customColorInput, {
    getEntity: sceneControls.getSelectedEntity,
    preview: (value, entity) => entity.mesh.material.color.set(value),
    restore: (entity) => {
      entity.mesh.material.color.set(entity.color);
      if (sceneControls.getSelectedEntity() === entity) updateColorSelection(entity.color);
    },
    commit: (value, entity) => {
      sceneControls.setColor(value, entity);
      syncSelectedEntity();
    },
  }));

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

  localInputs.push(bindLocalInput(rotationSpeedInput, {
    getEntity: sceneControls.getSelectedEntity,
    preview: (value, entity) => {
      entity.previewRotationSpeed = Number(value);
      rotationSpeedOutput.value = `${value}°/s`;
    },
    restore: (entity) => {
      entity.previewRotationSpeed = undefined;
      if (sceneControls.getSelectedEntity() === entity) {
        rotationSpeedInput.value = String(entity.animation.speed);
        rotationSpeedOutput.value = `${entity.animation.speed}°/s`;
      }
    },
    commit: (value, entity) => {
      sceneControls.setRotationSpeed(Number(value), entity);
      syncSelectedEntity();
    },
  }));

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
