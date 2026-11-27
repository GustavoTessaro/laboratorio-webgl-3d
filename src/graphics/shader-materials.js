import * as THREE from 'three';
import { shaderSources } from './shader-sources.js';
import { shaderParameters } from './shader-settings.js';

const uniformName = (key) => `u${key[0].toUpperCase()}${key.slice(1)}`;

export function createPresetMaterial(id) {
  const material = new THREE.ShaderMaterial({
    ...shaderSources[id],
    name: id,
    uniforms: { uColorA: { value: new THREE.Color() }, uColorB: { value: new THREE.Color() },
      uOpacity: { value: 1 }, uPhase: { value: 0 } },
  });
  material.color = material.uniforms.uColorA.value;
  return material;
}

export function updatePresetUniforms(material, settings) {
  const uniforms = material.uniforms;
  const parameters = shaderParameters(settings.shader);
  uniforms.uColorB.value.set(parameters.colorB);
  uniforms.uOpacity.value = settings.opacity;
  for (const [key, value] of Object.entries(parameters)) {
    if (key === 'colorB' || key === 'speed') continue;
    const uniform = uniforms[uniformName(key)] ??= { value: 0 };
    uniform.value = key === 'direction' ? THREE.MathUtils.degToRad(value) : value;
  }
  material.userData.speed = parameters.speed ?? 0;
}

export function advanceShaderTime(material, delta) {
  if (material?.isShaderMaterial && material.userData.speed) {
    const phase = material.uniforms.uPhase;
    phase.value = (phase.value + material.userData.speed * delta) % (2 * Math.PI);
  }
}

export function createShaderDiagnostics(renderer) {
  const failed = new Set();
  const debug = renderer.debug;
  if (!debug) return { failed, refresh: () => false, dispose() {} };
  const previous = debug.onShaderError;
  let dirty = false;
  function report(gl, program, vertexShader, fragmentShader) {
    const id = gl.getShaderSource(fragmentShader)?.match(/#define LAB_SHADER_(\w+) 1/)?.[1];
    if (Object.hasOwn(shaderSources, id)) {
      failed.add(id);
      dirty = true;
      console.warn(`Shader ${id}: fallback aplicado após falha GLSL.`, gl.getProgramInfoLog(program));
    } else if (previous) previous(gl, program, vertexShader, fragmentShader);
    else console.error(gl.getProgramInfoLog(program), gl.getShaderInfoLog(vertexShader), gl.getShaderInfoLog(fragmentShader));
  }
  debug.onShaderError = report;
  return {
    failed,
    refresh() { const changed = dirty; dirty = false; return changed; },
    dispose() { if (debug.onShaderError === report) debug.onShaderError = previous; },
  };
}
