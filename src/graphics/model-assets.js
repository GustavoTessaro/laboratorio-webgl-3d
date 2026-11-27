import { Box3, Group, LoadingManager, Sphere, Vector3 } from 'three';
import { validateGltf } from './gltf-validation.js';
import { modelCatalog, modelLimits } from './model-settings.js';

function resourceTracker() {
  const geometries = new Set();
  const materials = new Set();
  const textures = new Set();
  const bitmaps = new Set();
  let disposed = false;
  function track(value, set, release) {
    if (set.has(value)) return;
    set.add(value);
    if (disposed) release(value);
  }
  const release = (value) => value.dispose();
  const close = (value) => value.close?.();
  function visit(resource) {
    if (resource?.isObject3D) {
      resource.traverse((child) => {
        visit(child.geometry);
        for (const material of [].concat(child.material ?? [])) visit(material);
      });
    } else if (resource?.isBufferGeometry) {
      track(resource, geometries, release);
    } else if (resource?.isMaterial) {
      track(resource, materials, release);
      for (const property of Object.values(resource)) if (property?.isTexture) visit(property);
    } else if (resource?.isTexture) {
      track(resource, textures, release);
      if (resource.image?.close) track(resource.image, bitmaps, close);
    }
  }
  return {
    visit,
    materials,
    textures,
    dispose() {
      if (disposed) return;
      disposed = true;
      for (const set of [geometries, materials, textures]) for (const resource of set) release(resource);
      for (const bitmap of bitmaps) close(bitmap);
    },
  };
}

export async function loadModelAsset(input, name, signal) {
  signal?.throwIfAborted();
  const { document, buffers, images, info } = validateGltf(input);
  const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
  signal?.throwIfAborted();
  const urls = new Set();
  const resources = resourceTracker();
  function localUrl(bytes, type) {
    const url = URL.createObjectURL(new Blob([bytes], { type }));
    urls.add(url);
    return url;
  }
  try {
    document.buffers = buffers.map((data) => ({ byteLength: data.length, uri: localUrl(data) }));
    document.images = images.map(({ bytes, type }) => ({ uri: localUrl(bytes, type), mimeType: type }));
    const manager = new LoadingManager();
    manager.setURLModifier((url) => {
      if (!urls.has(url)) throw new Error('Recurso não autorizado pelo importador local.');
      return url;
    });
    const loader = new GLTFLoader(manager);
    // Track resolved dependencies as well as the scene so a failed parse can release partial assets.
    loader.register((parser) => {
      const getDependency = parser.getDependency.bind(parser);
      const loadGeometry = parser.loadGeometries.bind(parser);
      parser.getDependency = (type, index) => getDependency(type, index).then((dependency) => {
        if (type === 'texture' && !dependency) throw new Error('Não foi possível decodificar uma textura do modelo.');
        resources.visit(dependency);
        return dependency;
      });
      parser.loadGeometries = (...args) => loadGeometry(...args).then((geometries) => {
        geometries.forEach(resources.visit);
        return geometries;
      });
      return { name: 'LaboratorioResourceTracker' };
    });
    const result = await loader.parseAsync(JSON.stringify(document), '');
    resources.visit(result.scene);
    signal?.throwIfAborted();
    const attached = resourceTracker();
    attached.visit(result.scene);
    let pixels = 0;
    for (const texture of attached.textures) {
      const { width, height } = texture.image ?? {};
      if (!(width > 0 && height > 0 && width <= modelLimits.textureSide && height <= modelLimits.textureSide)) {
        throw new Error('Textura decodificada fora dos limites.');
      }
      pixels += width * height;
    }
    if (attached.materials.size > modelLimits.materials || attached.textures.size > modelLimits.textures ||
        pixels > modelLimits.pixels) throw new Error('O modelo excede o orçamento de materiais, texturas ou pixels decodificados.');
    return normalizedAsset(result.scene, name, {
      ...info, materials: Math.max(info.materials, attached.materials.size),
      textures: Math.max(info.textures, attached.textures.size), pixels: Math.max(info.pixels, pixels),
    }, resources);
  } catch (error) {
    resources.dispose();
    throw error;
  } finally {
    for (const url of urls) URL.revokeObjectURL(url);
  }
}

function normalizedAsset(source, name, info, resources) {
  const bounds = new Box3().setFromObject(source, true);
  const center = bounds.getCenter(new Vector3());
  const size = bounds.getSize(new Vector3());
  const extent = Math.max(size.x, size.y, size.z);
  if (bounds.isEmpty() || ![...bounds.min, ...bounds.max].every((v) => Number.isFinite(v) && Math.abs(v) <= 1e7) ||
      extent <= 1e-7) {
    throw new Error('O modelo possui dimensões degeneradas ou excessivas.');
  }
  const factor = 2 / extent;
  const normalization = new Group();
  normalization.name = 'Normalização do laboratório';
  normalization.scale.setScalar(factor);
  normalization.position.copy(center).multiplyScalar(-factor);
  normalization.add(source);
  const halfSize = size.clone().multiplyScalar(factor / 2);
  const root = new Group();
  root.add(normalization);
  const meshNames = [];
  const attributes = new Set();
  let indices = 0;
  let indexed = 0;
  let vertices = 0;
  let triangles = 0;
  source.traverse((object) => {
    if (!object.isMesh) return;
    const count = object.geometry.getAttribute('position').count;
    vertices += count;
    triangles += (object.geometry.index?.count ?? count) / 3;
    object.castShadow = true;
    object.receiveShadow = true;
    meshNames.push(object.name || `Malha ${meshNames.length + 1}`);
    if (object.geometry.index) {
      indices += object.geometry.index.count;
      indexed += 1;
    }
    for (const key of Object.keys(object.geometry.attributes)) attributes.add(key);
  });
  if (vertices !== info.vertices || triangles !== info.triangles || meshNames.length !== info.meshes) {
    throw new Error('A malha decodificada não corresponde à complexidade validada.');
  }
  const box = new Box3(halfSize.clone().negate(), halfSize.clone());
  const facts = { type: 'glTF 2.0', vertices, indices, triangles, box,
    indexed: indexed ? (indexed === meshNames.length ? true : 'Mista') : false,
    attributes: [...attributes].join(', '), dimensions: halfSize.clone().multiplyScalar(2),
    sphereRadius: box.getBoundingSphere(new Sphere()).radius };
  let refs = 1;
  const asset = {
    name, halfSize, info: { ...info, meshNames, originalSize: size, factor }, facts,
    instantiate() {
      if (!refs) throw new Error('O modelo já foi liberado.');
      refs += 1;
      return root.clone(true);
    },
    release() {
      if (refs && --refs === 0) resources.dispose();
    },
  };
  return asset;
}

export function createModelLibrary() {
  const assets = new Map();
  const pending = new Map();
  const lifetime = new AbortController();
  return {
    get: (type) => assets.get(type),
    load(type) {
      if (assets.has(type)) return Promise.resolve(assets.get(type));
      if (pending.has(type)) return pending.get(type);
      const entry = modelCatalog[type];
      if (!Object.hasOwn(modelCatalog, type)) throw new Error('Modelo de catálogo desconhecido.');
      const task = (async () => {
        const response = await fetch(`${import.meta.env?.BASE_URL ?? '/'}models/${entry.file}`, { signal: lifetime.signal, redirect: 'error' });
        if (!response.ok) throw new Error('Não foi possível carregar o exemplo local.');
        const asset = await loadModelAsset(await response.arrayBuffer(), entry.name, lifetime.signal);
        if (['bytes', 'vertices', 'triangles', 'meshes', 'materials', 'textures', 'pixels'].some((k) => asset.info[k] !== entry[k]) ||
            asset.halfSize.toArray().some((value, i) => value > entry.halfSize[i] || entry.halfSize[i] - value > 0.00001)) {
          asset.release();
          throw new Error('O arquivo de exemplo não corresponde aos limites do catálogo.');
        }
        assets.set(type, asset);
        return asset;
      })().finally(() => pending.delete(type));
      pending.set(type, task);
      return task;
    },
    dispose() {
      lifetime.abort();
      for (const asset of assets.values()) asset.release();
      assets.clear();
    },
  };
}
