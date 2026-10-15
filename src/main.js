import './style.css';
import { createScene } from './scene.js';

const container = document.querySelector('#scene-container');
const message = document.querySelector('#webgl-message');

try {
  createScene(container);
} catch (error) {
  console.error('Não foi possível inicializar o WebGL.', error);
  message.hidden = false;
  container.classList.add('scene-container--unsupported');
}
