import * as THREE from 'three';
import textureCatalog from '../../backend/Laboratorio.Collaboration/Contracts/TextureCatalog.json' with { type: 'json' };
import { normalizeShader, sameShader, shaderDisplacement } from './shader-settings.js';
import { advanceShaderTime, createPresetMaterial, updatePresetUniforms } from './shader-materials.js';

export { textureCatalog };
export const SOLID_MATERIAL = { color: '#6c8cff', wireframe: false };
export const TEXTURE_TRANSFORM = Object.freeze({ repeatU: 1, repeatV: 1, offsetU: 0, offsetV: 0, textureRotation: 0 });
export const MATERIAL_DEFAULTS = Object.freeze({
  kind: 'standard', opacity: 1, transparent: false, side: 'front',
  roughness: 0.38, metalness: 0.12, shininess: 30, specular: '#111111',
  emissive: '#000000', emissiveIntensity: 1, textureId: null, shader: null, ...TEXTURE_TRANSFORM,
});
export const MATERIAL_RANGES = {
  opacity: [0, 1, 0.01], roughness: [0, 1, 0.01], metalness: [0, 1, 0.01],
  shininess: [0, 200, 1], emissiveIntensity: [0, 5, 0.05],
  repeatU: [0.1, 10, 0.1], repeatV: [0.1, 10, 0.1],
  offsetU: [-1, 1, 0.01], offsetV: [-1, 1, 0.01], textureRotation: [-180, 180, 1],
};
const constructors = { basic: THREE.MeshBasicMaterial, phong: THREE.MeshPhongMaterial, standard: THREE.MeshStandardMaterial };
const sides = { front: THREE.FrontSide, back: THREE.BackSide, double: THREE.DoubleSide };
const settingsKeys = Object.keys(MATERIAL_DEFAULTS);

export function sameMaterialSettings(first, second) {
  return sameShader(first?.shader, second?.shader) && settingsKeys.every((key) => key === 'shader' ||
    (first?.[key] ?? MATERIAL_DEFAULTS[key]) === (second?.[key] ?? MATERIAL_DEFAULTS[key]));
}

export function normalizeMaterialSettings(input) {
  if (input != null && (typeof input !== 'object' || Array.isArray(input) ||
      Object.keys(input).some((key) => !Object.hasOwn(MATERIAL_DEFAULTS, key)))) {
    throw new Error('Configuração de material inválida.');
  }
  const settings = { ...MATERIAL_DEFAULTS, ...input };
  if ((!Object.hasOwn(constructors, settings.kind) && settings.kind !== 'shader') || !Object.hasOwn(sides, settings.side) ||
      typeof settings.transparent !== 'boolean' ||
      (settings.textureId !== null && !Object.hasOwn(textureCatalog, settings.textureId))) {
    throw new Error('Tipo, face, transparência ou identificador de textura inválido.');
  }
  for (const key of ['specular', 'emissive']) {
    if (typeof settings[key] !== 'string' || settings[key].length !== 7 || !/^#[0-9a-f]{6}$/i.test(settings[key])) {
      throw new Error('Use uma cor hexadecimal com seis dígitos.');
    }
    settings[key] = settings[key].toLowerCase();
  }
  for (const [key, [min, max]] of Object.entries(MATERIAL_RANGES)) {
    if (!Number.isFinite(settings[key]) || settings[key] < min || settings[key] > max) {
      throw new Error(`Valor fora dos limites de ${key}.`);
    }
  }
  settings.shader = normalizeShader(settings.shader);
  if (settings.kind === 'shader' && settings.shader === null) throw new Error('Selecione um shader predefinido.');
  return settings;
}

export function textureUrl(id) {
  return `${import.meta.env?.BASE_URL ?? '/'}textures/${textureCatalog[id].file}`;
}

export function createTexturePool(loader = new THREE.TextureLoader()) {
  const sources = new Map();
  return {
    acquire(id, onReady) {
      let entry = sources.get(id);
      if (!entry) {
        entry = { refs: 0, original: null, loaded: null };
        entry.loaded = loader.loadAsync(textureUrl(id)).then((texture) => {
          texture.colorSpace = THREE.SRGBColorSpace;
          texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
          entry.original = texture;
          if (!entry.refs) texture.dispose();
          return texture;
        }).catch(() => null);
        sources.set(id, entry);
      }
      entry.refs += 1;
      let active = true;
      let view;
      void entry.loaded.then((texture) => {
        if (!active) return;
        view = texture?.clone();
        onReady(view ?? null);
      });
      return () => {
        if (!active) return;
        active = false;
        view?.dispose();
        if (--entry.refs === 0) {
          sources.delete(id);
          entry.original?.dispose();
        }
      };
    },
  };
}

export function createMaterialController(mesh, pool, failedShaders = new Set()) {
  let activeKind;
  let settings;
  let activeTexture;
  let color;
  let mode;
  let releaseTexture;
  let map = null;

  function updateMap() {
    const { material } = mesh;
    if (map) {
      map.repeat.set(settings.repeatU, settings.repeatV);
      map.offset.set(settings.offsetU, settings.offsetV);
      map.center.set(0.5, 0.5);
      map.rotation = THREE.MathUtils.degToRad(settings.textureRotation);
    }
    if (material.map !== map) {
      material.map = map;
      material.needsUpdate = true;
    }
  }

  return {
    apply(nextColor, nextMode, next) {
      color = nextColor;
      mode = nextMode;
      const shader = next.kind === 'shader' ? next.shader.id : null;
      const fallback = shader && failedShaders.has(shader);
      const texture = shader ? null : next.textureId;
      const kind = fallback ? 'basic' : shader ? `shader/${shader}` : next.kind;
      const textureChanged = activeTexture !== texture;
      settings = next;
      if (activeKind !== kind) {
        mesh.material?.dispose();
        mesh.material = shader && !fallback ? createPresetMaterial(shader) : new constructors[kind]();
        activeKind = kind;
      }
      const material = mesh.material;
      material.color.set(color);
      material.opacity = next.opacity;
      const transparent = next.transparent || next.opacity < 1 || (shader === 'hologram' && !fallback);
      const wireframe = mode === 'wireframe';
      const side = sides[next.side];
      if (material.transparent !== transparent || material.wireframe !== wireframe || material.side !== side) {
        material.transparent = transparent;
        material.wireframe = wireframe;
        material.side = side;
        material.needsUpdate = true;
      }
      material.depthWrite = !transparent;
      const displacement = fallback ? 0 : shaderDisplacement(next);
      mesh.userData.shaderFallback = Boolean(fallback);
      mesh.userData.shaderDisplacement = displacement;
      mesh.frustumCulled = !displacement;
      mesh.castShadow = !displacement;
      mesh.receiveShadow = !shader;
      if (material.isShaderMaterial) updatePresetUniforms(material, next);
      if (material.isMeshStandardMaterial) {
        material.roughness = next.roughness;
        material.metalness = next.metalness;
      }
      if (material.isMeshPhongMaterial) {
        material.shininess = next.shininess;
        material.specular.set(next.specular);
      }
      if (material.emissive) {
        material.emissive.set(next.emissive);
        material.emissiveIntensity = next.emissiveIntensity;
      }

      if (textureChanged) {
        activeTexture = texture;
        releaseTexture?.();
        map = null;
        mesh.userData.textureStatus = texture ? 'loading' : null;
        releaseTexture = texture ? pool.acquire(texture, (loaded) => {
          map = loaded;
          mesh.userData.textureStatus = map ? 'ready' : 'error';
          updateMap();
          mesh.dispatchEvent({ type: 'texture-status' });
        }) : null;
      }
      if (!material.isShaderMaterial) updateMap();
    },
    updateTime(delta) { advanceShaderTime(mesh.material, delta); },
    refreshFallback() {
      if (mesh.material.isShaderMaterial && failedShaders.has(mesh.material.name)) {
        this.apply(color, mode, settings);
        mesh.dispatchEvent({ type: 'shader-status' });
      }
    },
    dispose() {
      releaseTexture?.();
      mesh.material.dispose();
    },
  };
}
