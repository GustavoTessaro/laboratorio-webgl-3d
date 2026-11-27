import * as THREE from 'three';

export const POSITION_PRECISION = 1_000_000;
export const INSPECTOR_SAMPLE_LIMIT = 512;
const factsByGeometry = new WeakMap();

export function inspectGeometry(geometry) {
  const cached = factsByGeometry.get(geometry);
  if (cached) return cached;
  const position = geometry.getAttribute('position');
  const vertices = position?.count ?? 0;
  const indices = geometry.index?.count ?? 0;
  const unique = new Set();
  for (let i = 0; i < vertices; i += 1) {
    const x = Math.round(position.getX(i) * POSITION_PRECISION);
    const y = Math.round(position.getY(i) * POSITION_PRECISION);
    const z = Math.round(position.getZ(i) * POSITION_PRECISION);
    unique.add(`${x},${y},${z}`);
  }
  if (!geometry.boundingBox) geometry.computeBoundingBox();
  if (!geometry.boundingSphere) geometry.computeBoundingSphere();
  const facts = {
    type: geometry.type,
    vertices,
    unique: unique.size,
    indices,
    indexed: geometry.index !== null,
    triangles: Math.floor((geometry.index ? indices : vertices) / 3),
    attributes: Object.entries(geometry.attributes).map(([name, attribute]) =>
      `${name} (${attribute.itemSize} × ${attribute.count})`).join(' · '),
    dimensions: geometry.boundingBox.getSize(new THREE.Vector3()),
    sphereRadius: geometry.boundingSphere.radius,
  };
  factsByGeometry.set(geometry, facts);
  return facts;
}

export function sampleIndices(count) {
  const amount = Math.min(count, INSPECTOR_SAMPLE_LIMIT);
  return Uint32Array.from({ length: amount }, (_, i) => Math.floor(i * count / amount));
}

export function matrixValue(matrix, row, column) {
  return matrix.elements[column * 4 + row];
}
