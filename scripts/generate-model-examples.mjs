import { mkdir, writeFile } from 'node:fs/promises';

const folder = new URL('../public/models/', import.meta.url);
await mkdir(folder, { recursive: true });

function box([x, y, z]) {
  const faces = [
    [[1, 0, 0], [[x,-y,-z],[x,y,-z],[x,y,z],[x,-y,z]]],
    [[-1, 0, 0], [[-x,-y,z],[-x,y,z],[-x,y,-z],[-x,-y,-z]]],
    [[0, 1, 0], [[-x,y,-z],[-x,y,z],[x,y,z],[x,y,-z]]],
    [[0, -1, 0], [[-x,-y,z],[-x,-y,-z],[x,-y,-z],[x,-y,z]]],
    [[0, 0, 1], [[x,-y,z],[x,y,z],[-x,y,z],[-x,-y,z]]],
    [[0, 0, -1], [[-x,-y,-z],[-x,y,-z],[x,y,-z],[x,-y,-z]]],
  ];
  return {
    positions: faces.flatMap(([, points]) => points.flat()),
    normals: faces.flatMap(([normal]) => Array.from({ length: 4 }, () => normal).flat()),
    uv: faces.flatMap(() => [0, 0, 0, 1, 1, 1, 1, 0]),
    indices: faces.flatMap((_, i) => [0, 1, 2, 0, 2, 3].map((value) => value + i * 4)),
  };
}

function makeModel(name, parts) {
  const doc = { asset: { version: '2.0', generator: 'Laboratório WebGL 3D' }, scene: 0,
    scenes: [{ nodes: [0] }], nodes: [{ name, children: [] }], meshes: [], materials: [],
    bufferViews: [], accessors: [], buffers: [] };
  const chunks = [];
  let length = 0;
  function accessor(data, type, componentType, lanes, limits = {}) {
    const bytes = Buffer.from(data.buffer);
    doc.bufferViews.push({ buffer: 0, byteOffset: length, byteLength: bytes.length });
    chunks.push(bytes, Buffer.alloc((4 - bytes.length % 4) % 4));
    length += bytes.length + chunks.at(-1).length;
    doc.accessors.push({ bufferView: doc.bufferViews.length - 1, componentType, count: data.length / lanes, type, ...limits });
    return doc.accessors.length - 1;
  }
  parts.forEach(([name, translation, size, color, metallicFactor = 0.1], index) => {
    const mesh = box(size);
    doc.meshes.push({ primitives: [{ attributes: {
      POSITION: accessor(new Float32Array(mesh.positions), 'VEC3', 5126, 3, { min: size.map((v) => -v), max: size }),
      NORMAL: accessor(new Float32Array(mesh.normals), 'VEC3', 5126, 3),
      TEXCOORD_0: accessor(new Float32Array(mesh.uv), 'VEC2', 5126, 2),
    }, indices: accessor(new Uint16Array(mesh.indices), 'SCALAR', 5123, 1), material: index }] });
    doc.nodes[0].children.push(index + 1);
    doc.nodes.push({ name, translation, mesh: index });
    doc.materials.push({ name, pbrMetallicRoughness: { baseColorFactor: [...color, 1], metallicFactor, roughnessFactor: 0.48 } });
  });
  doc.buffers.push({ byteLength: length });
  const json = Buffer.from(JSON.stringify(doc));
  const padded = Buffer.concat([json, Buffer.alloc((4 - json.length % 4) % 4, 0x20)]);
  const header = Buffer.alloc(20);
  header.write('glTF');
  header.writeUInt32LE(2, 4);
  header.writeUInt32LE(28 + padded.length + length, 8);
  header.writeUInt32LE(padded.length, 12);
  header.writeUInt32LE(0x4e4f534a, 16);
  const binHeader = Buffer.alloc(8);
  binHeader.writeUInt32LE(length, 0);
  binHeader.writeUInt32LE(0x004e4942, 4);
  return Buffer.concat([header, padded, binHeader, ...chunks]);
}

const blue = [0.08, 0.39, 0.82];
const gold = [0.95, 0.41, 0.08];
const jade = [0.07, 0.54, 0.32];
const white = [0.76, 0.83, 0.91];
const models = {
  beacon: ['Farol modular', [
    ['Base', [0,0.2,0], [0.68,0.2,0.68], blue],
    ['Torre', [0,1.05,0], [0.34,0.65,0.34], white],
    ['Lanterna', [0,1.9,0], [0.45,0.2,0.45], gold],
    ['Cobertura', [0,2.2,0], [0.57,0.1,0.57], blue],
  ]],
  arch: ['Pórtico de blocos', [
    ['Pilar esquerdo', [-0.82,0.76,0], [0.26,0.76,0.28], jade],
    ['Pilar direito', [0.82,0.76,0], [0.26,0.76,0.28], jade],
    ['Verga', [0,1.69,0], [1.13,0.17,0.34], gold],
    ['Ornamento', [0,1.94,0], [0.28,0.08,0.32], white],
  ]],
  satellite: ['Satélite de laboratório', [
    ['Corpo', [0,0,0], [0.47,0.42,0.4], gold, 0.45],
    ['Painel esquerdo', [-0.96,0,0], [0.43,0.08,0.36], blue],
    ['Painel direito', [0.96,0,0], [0.43,0.08,0.36], blue],
    ['Antena', [0,0.65,0], [0.09,0.23,0.09], white],
  ]],
};
for (const [id, [name, parts]] of Object.entries(models)) {
  await writeFile(new URL(`${id}.glb`, folder), makeModel(name, parts));
}
