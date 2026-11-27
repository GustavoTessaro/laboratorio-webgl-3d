import { bindLocalInput } from './edit-gestures.js';
import { bindGeometryControls } from './geometry-controls.js';
import { bindMaterialControls } from './material-controls.js';
import { bindCameraControls } from './camera-controls.js';
import { bindTrajectoryControls } from './trajectory-controls.js';

export function createControlsPanel(root, sceneControls, { getLock, isLocked, onDelete }) {
  const lifetime = new AbortController();
  const { signal } = lifetime;
  const geometryControls = bindGeometryControls(root, sceneControls, signal);
  const materialControls = bindMaterialControls(root, sceneControls, signal, syncSelectedEntity);
  const cameraControls = bindCameraControls(root, sceneControls, signal);
  const trajectoryControls = bindTrajectoryControls(root.querySelector('[data-trajectory-controls]'), sceneControls, signal);
  const sceneObjectList = root.querySelector('#scene-object-list');
  const duplicateObjectButton = root.querySelector('[data-duplicate-object]');
  const deleteObjectButton = root.querySelector('[data-delete-object]');
  const copyPropertiesButton = root.querySelector('[data-copy-properties]');
  const applyPropertiesButton = root.querySelector('[data-apply-properties]');
  const objectActionMessage = root.querySelector('#object-action-message');
  const transformModeButtons = root.querySelectorAll('[data-transform-mode]');
  const colorButtons = root.querySelectorAll('[data-object-color]');
  const materialButtons = root.querySelectorAll('[data-material-mode]');
  const customColorInput = root.querySelector('#custom-object-color');
  const resetAppearanceButton = root.querySelector('[data-reset-appearance]');
  const rotationToggleButton = root.querySelector('[data-toggle-rotation]');
  const rotationStatus = root.querySelector('[data-animation-status]');
  const rotationSpeedInput = root.querySelector('#rotation-speed');
  const rotationSpeedOutput = root.querySelector('#rotation-speed-value');
  const rotationAxisButtons = root.querySelectorAll('[data-rotation-axis]');
  const resetOrientationButton = root.querySelector('[data-reset-orientation]');

  root.ownerDocument.addEventListener('trajectory-out-of-bounds', () => {
    const message = 'A transformação faria a trajetória ultrapassar os limites da cena.';
    trajectoryControls.report(message);
    objectActionMessage.hidden = false;
    objectActionMessage.textContent = message;
  }, { signal });

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
    cameraControls.syncSelection(hasSelection);
    const lockedByAnotherParticipant = Boolean(entity && isLocked(entity.id));
    for (const input of localInputs) {
      if (input.entity && (input.entity !== entity || lockedByAnotherParticipant)) input.cancel();
    }
    sceneControls.setSelectedEntityEditable(!lockedByAnotherParticipant);
    geometryControls.sync(entity, lockedByAnotherParticipant);
    materialControls.sync(entity, lockedByAnotherParticipant);
    trajectoryControls.sync(entity, lockedByAnotherParticipant);
    const selectionDependentControls = [
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
      [...colorButtons, ...materialButtons, ...rotationAxisButtons].forEach((button) => {
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

    if (!colorGesture.entity) updateColorSelection(entity.color);
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
    if (!speedGesture.entity) {
      rotationSpeedInput.value = String(entity.animation.speed);
      rotationSpeedOutput.value = `${entity.animation.speed}°/s`;
    }
    rotationAxisButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.rotationAxis === entity.animation.axis));
    });
  }

  function renderEntityList() {
    const items = sceneControls.getEntities().map((entity) => {
      const item = root.ownerDocument.createElement('div');
      item.className = 'scene-object-item';
      item.setAttribute('role', 'listitem');

      const button = root.ownerDocument.createElement('button');
      button.className = 'scene-object-option';
      button.type = 'button';
      button.dataset.entityId = entity.id;
      const lock = getLock(entity.id);
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
      item.append(button);
      return item;
    });
    sceneObjectList.replaceChildren(...items);
    updateObjectListSelection();
  }

  sceneObjectList.addEventListener('click', (event) => {
    const button = event.target.closest('[data-entity-id]');
    if (button) sceneControls.selectEntity(button.dataset.entityId);
  }, { signal });

  transformModeButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const mode = button.getAttribute('aria-pressed') === 'true'
        ? null
        : button.dataset.transformMode;
      sceneControls.setTransformMode(mode);
      cameraControls.syncSpace();
      transformModeButtons.forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button && mode !== null));
      });
    }, { signal });
  });

  duplicateObjectButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity) return;

    const duplicate = sceneControls.duplicateEntity(entity.id);
    objectActionMessage.hidden = Boolean(duplicate);
    objectActionMessage.textContent = duplicate
      ? ''
      : 'Não foi possível duplicar: não há uma posição válida dentro dos limites.';
  }, { signal });

  deleteObjectButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity) return;
    objectActionMessage.hidden = true;
    objectActionMessage.textContent = '';
    onDelete(entity.id);
  }, { signal });

  copyPropertiesButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity) return;
    sceneControls.copyEntityProperties(entity.id);
    applyPropertiesButton.disabled = false;
    objectActionMessage.hidden = true;
    objectActionMessage.textContent = '';
  }, { signal });

  applyPropertiesButton.addEventListener('click', () => {
    const entity = sceneControls.getSelectedEntity();
    if (!entity || !sceneControls.hasCopiedProperties()) return;
    const applied = sceneControls.applyCopiedProperties(entity.id);
    objectActionMessage.hidden = applied;
    objectActionMessage.textContent = applied ? '' : 'As propriedades copiadas não cabem nos limites da trajetória neste objeto.';
  }, { signal });

  colorButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { objectColor } = button.dataset;
      sceneControls.setColor(objectColor);
      syncSelectedEntity();
    }, { signal });
  });

  const colorGesture = bindLocalInput(customColorInput, {
    signal,
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
  });

  materialButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { materialMode } = button.dataset;
      sceneControls.setWireframe(materialMode === 'wireframe');
      syncSelectedEntity();
    }, { signal });
  });

  resetAppearanceButton.addEventListener('click', () => {
    sceneControls.resetAppearance();
    syncSelectedEntity();
  }, { signal });

  function updateRotation(action) {
    try {
      action();
      trajectoryControls.report('');
      syncSelectedEntity();
    } catch (error) {
      rotationStatus.textContent = error.message;
      trajectoryControls.report(error.message);
    }
  }

  rotationToggleButton.addEventListener('click', () => {
    updateRotation(sceneControls.toggleRotation);
  }, { signal });

  const speedGesture = bindLocalInput(rotationSpeedInput, {
    signal,
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
      updateRotation(() => sceneControls.setRotationSpeed(Number(value), entity));
    },
  });

  rotationAxisButtons.forEach((button) => {
    button.addEventListener('click', () => {
      updateRotation(() => sceneControls.setRotationAxis(button.dataset.rotationAxis));
    }, { signal });
  });

  resetOrientationButton.addEventListener('click', () => {
    updateRotation(sceneControls.resetOrientation);
  }, { signal });

  const localInputs = [colorGesture, speedGesture];

  function cancelLocalInputs(entityId) {
    geometryControls.cancel(entityId);
    materialControls.cancel(entityId);
    trajectoryControls.cancel(entityId);
    for (const input of localInputs) {
      if (entityId === undefined || input.entity?.id === entityId) input.cancel();
    }
  }

  return {
    syncSelectedEntity,
    renderEntityList,
    cancelLocalInputs,
    dispose() {
      lifetime.abort();
      geometryControls.dispose();
      cameraControls.dispose();
      cancelLocalInputs();
    },
  };
}
