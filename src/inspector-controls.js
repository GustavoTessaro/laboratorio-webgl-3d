import { INSPECTOR_SAMPLE_LIMIT, matrixValue } from './graphics/inspection-data.js';
import { geometries } from './graphics/geometries.js';
import { textureCatalog } from './graphics/object-materials.js';
import { shaderCatalog, shaderLabels, shaderParameters, shaderDisplacement } from './graphics/shader-settings.js';

const numeric = new Intl.NumberFormat('pt-BR', { maximumFractionDigits: 3 });
const matrixNumber = new Intl.NumberFormat('pt-BR', {
  minimumFractionDigits: 3, maximumFractionDigits: 3, useGrouping: false,
});

const geometryLabels = {
  name: 'Objeto', type: 'Geometria', material: 'Material', vertices: 'Vértices armazenados',
  unique: 'Posições únicas', indices: 'Índices', triangles: 'Triângulos da malha', indexed: 'Indexação',
  attributes: 'Atributos (componentes × itens)', dimensions: 'Dimensões locais X/Y/Z',
  sphere: 'Raio local da esfera', conservative: 'Caixa conservadora X/Y/Z', texture: 'Textura', animation: 'Animação',
  shader: 'Shader', uniforms: 'Parâmetros e uniforms', deformation: 'Malha deformada',
  hierarchy: 'Hierarquia',
  localBox: 'Caixa local (mínimo → máximo)',
};
const poseLabels = {
  basePosition: 'Posição base', baseRotation: 'Rotação base (° XYZ)', baseScale: 'Escala base',
  visualPosition: 'Posição visual', visualRotation: 'Rotação visual (° XYZ)', visualScale: 'Escala visual',
  camera: 'Projeção da câmera',
};
const performanceLabels = {
  fps: 'FPS médio recente', frame: 'Último quadro (ms)',
  calls: 'Draw calls', triangles: 'Triângulos renderizados', points: 'Pontos renderizados', lines: 'Linhas renderizadas',
  geometries: 'Geometrias no renderer', textures: 'Texturas no renderer',
  objects: 'Objetos editáveis', particles: 'Partículas ativas', lights: 'Luzes ativas',
};
const matrixLabels = {
  base: 'Transformação base', local: 'Matriz local visual', world: 'Matriz global visual',
  view: 'Visualização da câmera', projection: 'Projeção da câmera',
};

function display(node, value) {
  const text = typeof value === 'number' ? numeric.format(value) : value ?? '—';
  if (node.textContent !== text) node.textContent = text;
}

function readout(container, labels) {
  const document = container.ownerDocument;
  return Object.fromEntries(Object.entries(labels).map(([key, label]) => {
    const term = document.createElement('dt');
    term.textContent = label;
    const value = document.createElement('dd');
    display(value, null);
    container.append(term, value);
    return [key, value];
  }));
}

function matrixTable(container, label, key) {
  const table = container.ownerDocument.createElement('table');
  table.className = 'inspection-matrix';
  table.dataset.inspectorMatrix = key;
  table.createCaption().textContent = label;
  const body = table.createTBody();
  const cells = [];
  for (let row = 0; row < 4; row += 1) {
    const line = body.insertRow();
    for (let column = 0; column < 4; column += 1) {
      const cell = line.insertCell();
      display(cell, null);
      cells.push(cell);
    }
  }
  container.append(table);
  return { table, cells, last: new Float64Array(16).fill(NaN) };
}

function renderMatrix({ table, cells, last }, matrix) {
  table.hidden = !matrix;
  if (!matrix) return;
  for (let i = 0; i < 16; i += 1) {
    const value = matrixValue(matrix, Math.floor(i / 4), i % 4);
    const rounded = Math.round(value * 1000) / 1000 || 0;
    if (last[i] === rounded) continue;
    last[i] = rounded;
    display(cells[i], matrixNumber.format(rounded));
  }
}

function drawHistory(canvas, history) {
  const context = canvas.getContext('2d');
  if (!context) return;
  const { width, height } = canvas;
  context.clearRect(0, 0, width, height);
  if (!history.length) return;
  let span = 20;
  for (let i = 0; i < history.length; i += 1) span = Math.max(span, history.at(i));
  context.strokeStyle = '#91b2ff';
  context.lineWidth = 1.5;
  context.beginPath();
  for (let i = 0; i < history.length; i += 1) {
    const x = width - 2 - (history.length - 1 - i) * (width - 4) / 59;
    const y = height - 2 - history.at(i) / span * (height - 4);
    if (i === 0) context.moveTo(x, y);
    else context.lineTo(x, y);
  }
  context.stroke();
}

function vector(value, factor = 1) {
  if (!value) return null;
  return `${numeric.format(value.x * factor)} · ${numeric.format(value.y * factor)} · ${numeric.format(value.z * factor)}`;
}

export function bindInspectorControls(root, inspector, signal) {
  const empty = root.querySelector('[data-inspector-empty]');
  const geometry = readout(root.querySelector('[data-inspector-geometry]'), geometryLabels);
  const pose = readout(root.querySelector('[data-inspector-pose]'), poseLabels);
  const performance = readout(root.querySelector('[data-inspector-performance]'), performanceLabels);
  const sampling = root.querySelector('[data-inspector-sampling]');
  const transforms = root.querySelector('[data-inspector-transforms]');
  const canvas = root.querySelector('[data-inspector-history]');
  const matrixArea = root.querySelector('[data-inspector-matrices]');
  const matrices = Object.fromEntries(Object.entries(matrixLabels).map(([key, label]) =>
    [key, matrixTable(matrixArea, label, key)]));
  const overlays = root.querySelectorAll('[data-inspector-overlay]');
  for (const input of overlays) {
    input.addEventListener('change', () => inspector.setOverlay(input.dataset.inspectorOverlay, input.checked), { signal });
  }

  function updateGeometry(entity, facts) {
    const settings = entity?.previewMaterialSettings ?? entity?.materialSettings;
    const shader = settings?.kind === 'shader' ? settings.shader : null;
    const texture = shader ? null : settings?.textureId;
    const animation = entity?.animation;
    const motion = entity?.trajectoryPreview === undefined ? entity?.trajectoryMotion : entity.trajectoryPreview;
    display(geometry.name, entity?.name);
    const model = entity?.model;
    display(geometry.type, facts ? (model ? facts.type : `${geometries[entity.type].name} · ${facts.type}`) : null);
    display(geometry.hierarchy, model ? `${model.info.meshes} malha(s) · ${model.info.meshNames.slice(0, 6).join(', ')}${model.info.meshes > 6 ? '…' : ''}` : null);
    display(geometry.material, model ? `${model.info.materials} material(is) original(is)` : entity?.mesh.material.type);
    for (const key of ['vertices', 'unique', 'indices', 'triangles', 'attributes']) display(geometry[key], facts?.[key]);
    display(geometry.indexed, facts ? (typeof facts.indexed === 'string' ? facts.indexed : facts.indexed ? 'Indexada' : 'Não indexada') : null);
    display(geometry.dimensions, vector(facts?.dimensions));
    display(geometry.sphere, facts?.sphereRadius);
    display(geometry.localBox, facts?.box ? `${vector(facts.box.min)} → ${vector(facts.box.max)}` : null);
    const halfSize = entity?.geometrySpec.halfSize;
    const displacement = shaderDisplacement(settings);
    display(geometry.conservative, vector(halfSize && { x: halfSize.x, y: halfSize.y + displacement, z: halfSize.z }, 2));
    display(geometry.shader, shader && `${shaderCatalog[shader.id].name}${entity.mesh.userData.shaderFallback ? ' · fallback Basic' : ''}`);
    display(geometry.uniforms, shader && [
      `Cor primária ${entity.color}`, `Opacidade ${numeric.format(settings.opacity)}`,
      ...Object.entries(shaderParameters(shader)).map(([key, value]) =>
        `${shaderLabels[key]} ${typeof value === 'number' ? numeric.format(value) : value}`),
      ...(entity.mesh.material.userData.speed ? [`Fase local ${numeric.format(entity.mesh.material.uniforms.uPhase.value)} rad`] : []),
    ].join(' · '));
    display(geometry.deformation, displacement
      ? 'Vértices, normais, caixa, esfera e seleção usam a malha CPU. O enquadramento inclui a amplitude. Sem sombra projetada durante a deformação.'
      : null);
    const status = entity?.mesh.userData.textureStatus;
    display(geometry.texture, model ? `${model.info.textures} textura(s) original(is)` : entity ? (texture ? `${textureCatalog[texture]?.name ?? texture}${status === 'error'
      ? ' (falha de carregamento)' : status === 'loading' ? ' (carregando)' : ''}` : 'Sem textura') : null);
    display(geometry.animation, animation ? (animation.enabled
      ? `${entity.editingTransform ? 'Suspensa pelo gizmo' : 'Ativa'} · ${animation.axis.toUpperCase()} · ${numeric.format(animation.speed)}°/s`
      : 'Rotação desativada') + (motion
        ? ` · Trajetória ${entity.editingTransform || motion.paused ? 'pausada' : 'ativa'}`
        : '') : null);
    display(sampling, model ? 'Os totais somam a hierarquia normalizada. A esfera envolve sua caixa. Vértices únicos e auxiliares por vértice só estão disponíveis nas formas editáveis.' :
      (facts?.vertices ?? 0) > INSPECTOR_SAMPLE_LIMIT
      ? `Amostragem uniforme de até ${INSPECTOR_SAMPLE_LIMIT} de ${numeric.format(facts.vertices)} vértices e normais.`
      : `Vértices armazenados e suas normais são exibidos até o limite de ${INSPECTOR_SAMPLE_LIMIT} amostras.`);
  }

  function updateTransforms({ entity, base, baseMatrix, camera }) {
    if (!transforms.open) return;
    const degrees = 180 / Math.PI;
    display(pose.basePosition, vector(base?.position));
    display(pose.baseRotation, vector(base?.rotation, degrees));
    display(pose.baseScale, vector(base?.scale));
    display(pose.visualPosition, vector(entity?.mesh.position));
    display(pose.visualRotation, vector(entity?.mesh.rotation, degrees));
    display(pose.visualScale, vector(entity?.mesh.scale));
    display(pose.camera, camera.isOrthographicCamera ? 'Ortográfica' : 'Perspectiva');
    renderMatrix(matrices.base, baseMatrix);
    renderMatrix(matrices.local, entity?.mesh.matrix);
    renderMatrix(matrices.world, entity?.mesh.matrixWorld);
    renderMatrix(matrices.view, camera.matrixWorldInverse);
    renderMatrix(matrices.projection, camera.projectionMatrix);
  }

  inspector.setSampleHandler((sample) => {
    const { entity, facts, counters, history } = sample;
    empty.hidden = Boolean(entity);
    for (const input of overlays) {
      input.disabled = !entity || Boolean(entity.model) ||
        (input.dataset.inspectorOverlay === 'normals' && !entity.mesh.geometry.hasAttribute('normal'));
    }
    updateGeometry(entity, facts);
    updateTransforms(sample);
    for (const [key, value] of Object.entries(counters)) display(performance[key], value);
    display(performance.fps, history.fps);
    display(performance.frame, history.frameMs);
    drawHistory(canvas, history);
  });
  root.addEventListener('toggle', () => inspector.setOpen(root.open), { signal });
  signal.addEventListener('abort', () => {
    inspector.setOpen(false);
    inspector.setSampleHandler();
  }, { once: true });
  inspector.setOpen(root.open);
}
