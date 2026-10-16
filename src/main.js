import './style.css';
import { createScene } from './scene.js';

const container = document.querySelector('#scene-container');
const message = document.querySelector('#webgl-message');
const addObjectButtons = document.querySelectorAll('[data-add-object]');
const sceneObjectList = document.querySelector('#scene-object-list');
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

try {
  const sceneControls = createScene(container);

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
    if (!entity) return;

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
    updateObjectListSelection();
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
      button.textContent = entity.name;
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

} catch (error) {
  console.error('Não foi possível inicializar o WebGL.', error);
  message.hidden = false;
  container.classList.add('scene-container--unsupported');
  document.querySelectorAll('button, input').forEach((control) => {
    control.disabled = true;
  });
}
