import * as THREE from 'three';
import catalog from '../../backend/Laboratorio.Collaboration/Contracts/GeometryCatalog.json' with { type: 'json' };

export const GEOMETRY_BUDGET = { vertices: 8192, triangles: 8192 };
export { catalog as geometries };

const factories = {
  box: (p) => new THREE.BoxGeometry(p.width, p.height, p.depth, p.widthSegments, p.heightSegments, p.depthSegments),
  sphere: (p) => new THREE.SphereGeometry(p.radius, p.widthSegments, p.heightSegments),
  pyramid: (p) => new THREE.ConeGeometry(p.radius, p.height, 4),
  torus: (p) => new THREE.TorusGeometry(p.radius, p.tube, p.radialSegments, p.tubularSegments),
  cylinder: (p) => new THREE.CylinderGeometry(p.radiusTop, p.radiusBottom, p.height, p.radialSegments, p.heightSegments),
  cone: (p) => new THREE.ConeGeometry(p.radius, p.height, p.radialSegments, p.heightSegments),
  plane: (p) => new THREE.PlaneGeometry(p.width, p.height, p.widthSegments, p.heightSegments),
  capsule: (p) => new THREE.CapsuleGeometry(p.radius, p.length, p.capSegments, p.radialSegments, p.heightSegments),
  tetrahedron: (p) => new THREE.TetrahedronGeometry(p.radius, p.detail),
  octahedron: (p) => new THREE.OctahedronGeometry(p.radius, p.detail),
  dodecahedron: (p) => new THREE.DodecahedronGeometry(p.radius, p.detail),
  icosahedron: (p) => new THREE.IcosahedronGeometry(p.radius, p.detail),
  torusKnot: (p) => new THREE.TorusKnotGeometry(p.radius, p.tube, p.tubularSegments, p.radialSegments, p.p, p.q),
};

export function describeGeometry(type, overrides = null) {
  if (!Object.hasOwn(catalog, type)) throw new Error(`Forma geométrica desconhecida: ${type}`);
  const fields = catalog[type].parameters;
  if (overrides !== null && (typeof overrides !== 'object' || Array.isArray(overrides))) {
    throw new Error('Os parâmetros da geometria devem ser um objeto.');
  }
  for (const key of Object.keys(overrides ?? {})) {
    if (!Object.hasOwn(fields, key)) throw new Error(`Parâmetro incompatível com a forma: ${key}`);
  }

  const parameters = {};
  const custom = {};
  for (const [key, [defaultValue, min, max, step]] of Object.entries(fields)) {
    const value = overrides && Object.hasOwn(overrides, key) ? overrides[key] : defaultValue;
    if (!Number.isFinite(value) || value < min || value > max || (step === 1 && !Number.isInteger(value))) {
      throw new Error(`Valor inválido para ${key}. Use valores entre ${min} e ${max}.`);
    }
    parameters[key] = value;
    if (value !== defaultValue) custom[key] = value;
  }
  return { type, parameters, overrides: Object.keys(custom).length ? custom : null, halfSize: geometryHalfSize(type, parameters) };
}

function geometryHalfSize(type, p) {
  const radial = (radius, halfHeight = radius) => new THREE.Vector3(radius, halfHeight, radius);
  switch (type) {
    case 'box': return new THREE.Vector3(p.width / 2, p.height / 2, p.depth / 2);
    case 'plane': return new THREE.Vector3(p.width / 2, p.height / 2, 0);
    case 'pyramid':
    case 'cone': return radial(p.radius, p.height / 2);
    case 'cylinder': return radial(Math.max(p.radiusTop, p.radiusBottom), p.height / 2);
    case 'capsule': return radial(p.radius, p.length / 2 + p.radius);
    case 'torus': return new THREE.Vector3(p.radius + p.tube, p.radius + p.tube, p.tube);
    case 'torusKnot': return new THREE.Vector3(1.5 * p.radius + p.tube, 1.5 * p.radius + p.tube, p.radius / 2 + p.tube);
    default: return radial(p.radius);
  }
}

export function createGeometry({ type, parameters }) {
  const geometry = factories[type](parameters);
  const vertices = geometry.getAttribute('position').count;
  const triangles = (geometry.index?.count ?? vertices) / 3;
  if (vertices > GEOMETRY_BUDGET.vertices || triangles > GEOMETRY_BUDGET.triangles) {
    geometry.dispose();
    throw new Error('A geometria ultrapassa o limite de vértices ou triângulos.');
  }
  return geometry;
}

export function sameGeometryParameters(first, second) {
  const keys = Object.keys(first ?? {});
  return keys.length === Object.keys(second ?? {}).length &&
    keys.every((key) => first[key] === second?.[key]);
}
