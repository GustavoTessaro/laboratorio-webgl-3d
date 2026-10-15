import './style.css';
import { createScene } from './scene.js';

const container = document.querySelector('#scene-container');
const message = document.querySelector('#webgl-message');
const objectButtons = document.querySelectorAll('[data-object-shape]');

try {
  const selectObject = createScene(container);

  objectButtons.forEach((button) => {
    button.addEventListener('click', () => {
      selectObject(button.dataset.objectShape);
      objectButtons.forEach((option) => {
        option.setAttribute('aria-pressed', String(option === button));
      });
    });
  });
} catch (error) {
  console.error('Não foi possível inicializar o WebGL.', error);
  message.hidden = false;
  container.classList.add('scene-container--unsupported');
  objectButtons.forEach((button) => {
    button.disabled = true;
  });
}
