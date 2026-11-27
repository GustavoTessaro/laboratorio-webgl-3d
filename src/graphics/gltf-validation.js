import { Matrix4, Quaternion, Vector3 } from 'three';
import { modelLimits as limits } from './model-settings.js';

const JSON_CHUNK = 0x4e4f534a;
const BIN_CHUNK = 0x004e4942;
const COMPONENT_BYTES = { 5120: 1, 5121: 1, 5122: 2, 5123: 2, 5125: 4, 5126: 4 };
const LANES = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4 };
const ELEMENTS = { POSITION: [3], NORMAL: [3], TANGENT: [4], TEXCOORD_0: [2], TEXCOORD_1: [2], COLOR_0: [3, 4] };
const index = (value, items) => Number.isInteger(value) && value >= 0 && value < items.length;
const bounded = (value, max) => Number.isInteger(value) && value >= 0 && value <= max;
const finiteVector = (value, length, max) => Array.isArray(value) && value.length === length &&
  value.every((component) => Number.isFinite(component) && Math.abs(component) <= max);

function requireValid(condition, message = 'Estrutura glTF inválida ou fora dos limites.') {
  if (!condition) throw new Error(message);
}

function list(document, key, max) {
  const values = document[key] ?? [];
  requireValid(Array.isArray(values) && values.length <= max && values.every((v) => v && typeof v === 'object' && !Array.isArray(v)));
  return values;
}

function decodeDataUri(uri, types) {
  requireValid(typeof uri === 'string', 'Recursos auxiliares devem estar incorporados ao arquivo.');
  const match = /^data:([a-z0-9/.+-]+);base64,([A-Za-z0-9+/]+={0,2})$/.exec(uri);
  requireValid(match && types.includes(match[1]) && match[2].length % 4 === 0,
    'Use somente recursos incorporados em Base64. URLs e arquivos auxiliares externos são rejeitados.');
  return { type: match[1], bytes: Uint8Array.from(atob(match[2]), (c) => c.charCodeAt(0)) };
}

function parseContainer(bytes) {
  requireValid(bytes.byteLength > 0 && bytes.byteLength <= limits.fileBytes, 'O arquivo deve ter até 4 MiB.');
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  let json = bytes;
  let binary;
  if (bytes.byteLength >= 4 && data.getUint32(0, true) === 0x46546c67) {
    requireValid(bytes.byteLength >= 20 && data.getUint32(4, true) === 2 && data.getUint32(8, true) === bytes.byteLength &&
      data.getUint32(16, true) === JSON_CHUNK, 'Cabeçalho GLB 2.0 inválido.');
    const end = 20 + data.getUint32(12, true);
    requireValid(end <= bytes.byteLength && end % 4 === 0);
    json = bytes.subarray(20, end);
    if (end !== bytes.byteLength) {
      requireValid(end + 8 <= bytes.byteLength && data.getUint32(end + 4, true) === BIN_CHUNK &&
        data.getUint32(end, true) === bytes.byteLength - end - 8 && bytes.byteLength % 4 === 0);
      binary = bytes.subarray(end + 8);
    }
  }
  requireValid(json.byteLength <= limits.jsonBytes, 'Metadados glTF excedem 512 KiB.');
  let document;
  try { document = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(json)); }
  catch { throw new Error('Os metadados JSON do modelo são inválidos.'); }
  requireValid(document?.asset?.version === '2.0' && !document.asset.minVersion &&
    typeof document === 'object', 'Somente glTF 2.0 é aceito.');
  return { document, binary };
}

function imageSize({ bytes, type }) {
  const data = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (type === 'image/png') {
    requireValid(bytes.length >= 33 && data.getUint32(0) === 0x89504e47 && data.getUint32(4) === 0x0d0a1a0a &&
      data.getUint32(8) === 13 && data.getUint32(12) === 0x49484452, 'Cabeçalho PNG inválido.');
    const dimensions = [data.getUint32(16), data.getUint32(20)];
    if (dimensions.some((value) => value > limits.textureSide)) return dimensions;
    let hasPixels = false;
    for (let offset = 8; offset + 12 <= bytes.length;) {
      const length = data.getUint32(offset);
      const marker = data.getUint32(offset + 4);
      const next = offset + 12 + length;
      requireValid(next <= bytes.length, 'Bloco PNG truncado.');
      requireValid(marker !== 0x6163544c, 'PNG animado não é aceito.');
      if (marker === 0x49444154) hasPixels = true;
      if (marker === 0x49454e44) {
        requireValid(length === 0 && hasPixels && next === bytes.length, 'PNG sem dados de imagem válidos.');
        return dimensions;
      }
      offset = next;
    }
    throw new Error('PNG incompleto.');
  }
  requireValid(type === 'image/jpeg' && bytes.length >= 4 && data.getUint16(0) === 0xffd8, 'Cabeçalho JPEG inválido.');
  let dimensions;
  for (let offset = 2; offset + 4 <= bytes.length;) {
    const marker = data.getUint16(offset);
    const length = data.getUint16(offset + 2);
    requireValid(marker >= 0xff00 && length >= 2 && offset + 2 + length <= bytes.length, 'Segmento JPEG inválido.');
    if ([0xffc0, 0xffc1, 0xffc2].includes(marker) && length >= 8) {
      requireValid(!dimensions, 'Imagem JPEG com múltiplos cabeçalhos.');
      dimensions = [data.getUint16(offset + 7), data.getUint16(offset + 5)];
    }
    if (marker === 0xffda && dimensions) return dimensions;
    offset += length + 2;
  }
  throw new Error('A imagem JPEG não possui dimensões reconhecíveis.');
}

function validateTree(document, nodes, meshes) {
  const scenes = list(document, 'scenes', 1);
  requireValid(scenes.length === 1 && (document.scene ?? 0) === 0);
  const used = new Set();
  const meshReferences = [];
  function visit(id, parent) {
    requireValid(index(id, nodes) && !used.has(id), 'A hierarquia contém um ciclo, nó repetido ou índice inválido.');
    used.add(id);
    const node = nodes[id];
    requireValid(node.skin === undefined && node.weights === undefined && node.camera === undefined);
    const matrix = new Matrix4();
    const trs = ['translation', 'rotation', 'scale'];
    if (node.matrix !== undefined) {
      requireValid(finiteVector(node.matrix, 16, 1e4) && trs.every((key) => node[key] === undefined) &&
        [3, 7, 11].every((i) => node.matrix[i] === 0) && node.matrix[15] === 1);
      matrix.fromArray(node.matrix);
    } else {
      const [translation, rotation, scale] = [node.translation ?? [0, 0, 0], node.rotation ?? [0, 0, 0, 1], node.scale ?? [1, 1, 1]];
      requireValid(finiteVector(translation, 3, 1e4) && finiteVector(rotation, 4, 1) && finiteVector(scale, 3, 1e4) &&
        Math.abs(Math.hypot(...rotation) - 1) < 0.001);
      matrix.compose(new Vector3(...translation), new Quaternion(...rotation), new Vector3(...scale));
    }
    matrix.premultiply(parent);
    requireValid(matrix.elements.every((v) => Number.isFinite(v) && Math.abs(v) <= 1e5) &&
      Number.isFinite(matrix.determinant()) && Math.abs(matrix.determinant()) > 1e-12, 'Transformação interna degenerada ou excessiva.');
    if (node.mesh !== undefined) {
      requireValid(index(node.mesh, meshes));
      meshReferences.push(node.mesh);
    }
    const children = node.children ?? [];
    requireValid(Array.isArray(children) && children.length <= nodes.length);
    for (const child of children) visit(child, matrix);
  }
  const roots = scenes[0].nodes;
  requireValid(Array.isArray(roots) && roots.length <= nodes.length);
  for (const node of roots) visit(node, new Matrix4());
  requireValid(used.size === nodes.length && meshReferences.length && new Set(meshReferences).size === meshes.length,
    'O modelo deve conter uma única hierarquia estática de malhas.');
  return meshReferences;
}

export function validateGltf(input) {
  const bytes = new Uint8Array(input);
  const { document, binary } = parseContainer(bytes);
  const stack = [document];
  while (stack.length) {
    const value = stack.pop();
    requireValid(!Object.hasOwn(value, 'extensions') &&
      ['extensionsRequired', 'extensionsUsed'].every((field) =>
        !Object.hasOwn(value, field) || (Array.isArray(value[field]) && value[field].length === 0)),
      'Extensões glTF, incluindo compactação e texturas especiais, não são aceitas.');
    for (const [key, child] of Object.entries(value)) {
      requireValid(!['__proto__', 'constructor', 'prototype'].includes(key));
      if (child && typeof child === 'object' && key !== 'extras') stack.push(child);
    }
    delete value.extras;
  }
  const animations = list(document, 'animations', 64);
  requireValid(!animations.length && !list(document, 'skins', 64).length,
    `Modelos estáticos somente. O arquivo contém ${animations.length} animação(ões) ou estrutura esquelética.`);
  requireValid(!list(document, 'cameras', 1).length, 'Câmeras internas não são aceitas.');
  const inputs = list(document, 'buffers', limits.buffers);
  let bufferBytes = 0;
  const buffers = inputs.map((buffer, i) => {
    const data = i === 0 && binary && buffer.uri === undefined ? binary :
      decodeDataUri(buffer.uri, ['application/octet-stream', 'application/gltf-buffer']).bytes;
    requireValid(bounded(buffer.byteLength, limits.fileBytes) && data.length >= buffer.byteLength &&
      data.length <= buffer.byteLength + (data === binary ? 3 : 0));
    bufferBytes += data.length;
    requireValid(bufferBytes <= limits.fileBytes);
    return data.subarray(0, buffer.byteLength);
  });
  const views = list(document, 'bufferViews', 160).map((view) => {
    requireValid(index(view.buffer, buffers));
    const start = view.byteOffset ?? 0;
    requireValid(bounded(start, buffers[view.buffer].length) && bounded(view.byteLength, buffers[view.buffer].length - start));
    requireValid(view.byteStride === undefined || (bounded(view.byteStride, 252) && view.byteStride >= 4 && view.byteStride % 4 === 0));
    return { data: buffers[view.buffer].subarray(start, start + view.byteLength), stride: view.byteStride, start };
  });
  const accessors = list(document, 'accessors', 160).map((accessor) => {
    requireValid(!accessor.sparse && index(accessor.bufferView, views));
    const view = views[accessor.bufferView];
    const size = COMPONENT_BYTES[accessor.componentType];
    const lanes = LANES[accessor.type];
    const offset = accessor.byteOffset ?? 0;
    const stride = view.stride ?? size * lanes;
    const count = accessor.count;
    requireValid(size && lanes && typeof size === 'number' && typeof lanes === 'number' &&
      bounded(count, limits.triangles * 3) && count > 0 && bounded(offset, view.data.length) &&
      offset % size === 0 && (view.start + offset) % size === 0 && stride >= size * lanes && stride % size === 0 &&
      offset + (count - 1) * stride + size * lanes <= view.data.length);
    const data = new DataView(view.data.buffer, view.data.byteOffset, view.data.byteLength);
    const min = Array(lanes).fill(Infinity);
    const max = Array(lanes).fill(-Infinity);
    if (accessor.componentType === 5126) {
      for (let i = 0; i < count; i += 1) {
        for (let j = 0; j < lanes; j += 1) {
          const value = data.getFloat32(offset + i * stride + j * size, true);
          requireValid(Number.isFinite(value) && Math.abs(value) <= 1e4, 'Atributo da malha contém valores inválidos.');
          min[j] = Math.min(min[j], value);
          max[j] = Math.max(max[j], value);
        }
      }
    }
    return { accessor, data, lanes, offset, stride, count, min, max };
  });
  let pixels = 0;
  const images = list(document, 'images', limits.textures).map((image) => {
    const resource = image.bufferView === undefined ? decodeDataUri(image.uri, ['image/png', 'image/jpeg'])
      : (requireValid(index(image.bufferView, views) && image.uri === undefined),
        { bytes: views[image.bufferView].data, type: image.mimeType });
    const [width, height] = imageSize(resource);
    pixels += width * height;
    requireValid(width > 0 && height > 0 && width <= limits.textureSide && height <= limits.textureSide && pixels <= limits.pixels,
      'Texturas limitadas a 1024 px por lado e 2.097.152 pixels por modelo.');
    return { ...resource, width, height };
  });
  const samplers = list(document, 'samplers', limits.textures);
  const textures = list(document, 'textures', limits.textures);
  for (const texture of textures) requireValid(index(texture.source, images) &&
    (texture.sampler === undefined || index(texture.sampler, samplers)));
  requireValid(textures.reduce((sum, texture) => {
    const { width, height } = images[texture.source];
    return sum + width * height;
  }, 0) <= limits.pixels, 'Orçamento de pixels das texturas excedido.');
  const materials = list(document, 'materials', limits.materials);
  for (const material of materials) {
    const pbr = material.pbrMetallicRoughness ?? {};
    requireValid((pbr.baseColorFactor === undefined || finiteVector(pbr.baseColorFactor, 4, 1)) &&
      (material.emissiveFactor === undefined || finiteVector(material.emissiveFactor, 3, 1)) &&
      [pbr.metallicFactor, pbr.roughnessFactor, material.alphaCutoff].every((v) =>
        v === undefined || (Number.isFinite(v) && v >= 0 && v <= 1)) &&
      (material.alphaMode === undefined || ['OPAQUE', 'MASK', 'BLEND'].includes(material.alphaMode)));
    for (const ref of [pbr.baseColorTexture, pbr.metallicRoughnessTexture, material.normalTexture,
      material.occlusionTexture, material.emissiveTexture]) {
      if (ref === undefined) continue;
      requireValid(ref && index(ref.index, textures) && [0, 1].includes(ref.texCoord ?? 0) &&
        [ref.scale, ref.strength].every((v) => v === undefined || (Number.isFinite(v) && Math.abs(v) <= 4)));
    }
  }
  const meshes = list(document, 'meshes', limits.meshes);
  const references = validateTree(document, list(document, 'nodes', limits.nodes), meshes);
  let triangles = 0;
  let vertices = 0;
  let primitives = 0;
  const usedMaterials = new Set();
  for (const id of references) {
    const mesh = meshes[id];
    requireValid(mesh.weights === undefined && Array.isArray(mesh.primitives) && mesh.primitives.length > 0 &&
      mesh.primitives.length <= limits.primitives);
    for (const primitive of mesh.primitives) {
      requireValid(primitive && typeof primitive === 'object' && (primitive.mode ?? 4) === 4 && primitive.targets === undefined,
        'Somente malhas triangulares estáticas são aceitas. Morph targets estão desativados.');
      requireValid(primitive.material === undefined || index(primitive.material, materials));
      usedMaterials.add(primitive.material ?? -1);
      const attributes = primitive.attributes;
      requireValid(attributes && index(attributes.POSITION, accessors));
      const position = accessors[attributes.POSITION];
      requireValid(position.accessor.componentType === 5126 && !position.accessor.normalized);
      position.accessor.min = position.min;
      position.accessor.max = position.max;
      for (const [key, id] of Object.entries(attributes)) {
        requireValid(Object.hasOwn(ELEMENTS, key) && index(id, accessors) && ELEMENTS[key].includes(accessors[id].lanes) &&
          accessors[id].count === position.count, 'Atributos da malha não são suportados ou têm contagens diferentes.');
      }
      let count = position.count;
      if (primitive.indices !== undefined) {
        requireValid(index(primitive.indices, accessors));
        const { accessor, offset, count: size, data, stride } = accessors[primitive.indices];
        requireValid(accessor.type === 'SCALAR' && [5121, 5123, 5125].includes(accessor.componentType) && !accessor.normalized);
        for (let i = 0; i < size; i += 1) {
          const at = offset + i * stride;
          const vertex = accessor.componentType === 5121 ? data.getUint8(at)
            : accessor.componentType === 5123 ? data.getUint16(at, true) : data.getUint32(at, true);
          requireValid(vertex < position.count, 'Um índice da malha aponta para um vértice inexistente.');
        }
        count = size;
      }
      requireValid(count % 3 === 0);
      primitives += 1;
      vertices += position.count;
      triangles += count / 3;
      requireValid(primitives <= limits.primitives && vertices <= limits.vertices && triangles <= limits.triangles,
        'O modelo excede o limite de primitivas, vértices ou triângulos.');
    }
  }
  requireValid(usedMaterials.size <= limits.materials, 'O modelo excede o limite de materiais.');
  return { document, buffers, images, info: { bytes: bytes.length, vertices, triangles, meshes: primitives,
    materials: usedMaterials.size, textures: textures.length, pixels: textures.reduce((sum, item) =>
      sum + images[item.source].width * images[item.source].height, 0), animations: 0 } };
}
