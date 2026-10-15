import './style.css';
import { createScene } from './scene.js';

const container = document.querySelector('#scene-container');
const message = document.querySelector('#webgl-message');
const objectButtons = document.querySelectorAll('[data-object-shape]');
const colorButtons = document.querySelectorAll('[data-object-color]');
const materialButtons = document.querySelectorAll('[data-material-mode]');
const customColorInput = document.querySelector('#custom-object-color');
const resetAppearanceButton = document.querySelector('[data-reset-appearance]');

try {
  const sceneControls = createScene(container);

  objectButtons.forEach((button) => {
    button.addEventListener('click', () => {
      sceneControls.selectObject(button.dataset.objectShape);
      objectButtons.forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button));
      });
    });
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

  colorButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { objectColor } = button.dataset;
      sceneControls.setColor(objectColor);
      updateColorSelection(objectColor);
    });
  });

  customColorInput.addEventListener('input', () => {
    sceneControls.setColor(customColorInput.value);
    updateColorSelection(customColorInput.value);
  });

  materialButtons.forEach((button) => {
    button.addEventListener('click', () => {
      const { materialMode } = button.dataset;
      sceneControls.setWireframe(materialMode === 'wireframe');
      materialButtons.forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button));
      });
    });
  });

  resetAppearanceButton.addEventListener('click', () => {
    sceneControls.resetAppearance();
    updateColorSelection('#6c8cff');
    materialButtons.forEach((button) => {
      button.setAttribute('aria-pressed', String(button.dataset.materialMode === 'solid'));
    });
  });
} catch (error) {
  console.error('Não foi possível inicializar o WebGL.', error);
  message.hidden = false;
  container.classList.add('scene-container--unsupported');
  document.querySelectorAll('button, input[type="color"]').forEach((button) => {
    button.disabled = true;
  });
}
