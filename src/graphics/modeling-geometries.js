import * as THREE from 'three';

const TICKS = 10000;
const EPS = 1e-9;
const MIN_AREA = 0.005;
const ROUNDING = 0.2;
const length2d = (x, y) => Math.sqrt(x * x + y * y);
const distance = (a, b) => length2d(a[0] - b[0], a[1] - b[1]);
const cross = (a, b, p) => (b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0]);
const mix = (a, b) => a.map((v, i) => v + (b[i] - v) * ROUNDING);

export function encodeModelingPoints(points) {
  return {
    pointCount: points.length,
    ...Object.fromEntries(points.flatMap(([x, y], i) => [
      [`x${i}`, Math.round(x * TICKS)], [`y${i}`, Math.round(y * TICKS)],
    ])),
  };
}

function readPoints(type, info, overrides) {
  const allowed = info.coordinateLimit * TICKS;
  const count = overrides?.pointCount;
  if (count === undefined) return info.presets[info.defaultPreset].points;
  if (!Number.isInteger(count) || count < (type === 'lathe' ? 2 : 3) || count > info.maxPoints) {
    throw new Error('Quantidade de pontos inválida.');
  }
  return Array.from({ length: count }, (_, index) => {
    const x = overrides[`x${index}`];
    const y = overrides[`y${index}`];
    if (!Number.isInteger(x) || !Number.isInteger(y) || Math.abs(x) > allowed || Math.abs(y) > allowed) {
      throw new Error('Cada ponto deve ter duas coordenadas válidas dentro dos limites.');
    }
    return [x / TICKS, y / TICKS];
  });
}

function onSegment(a, b, p) {
  return Math.abs(cross(a, b, p)) <= EPS &&
    p.every((v, i) => v >= Math.min(a[i], b[i]) - EPS && v <= Math.max(a[i], b[i]) + EPS);
}

function intersects(a, b, c, d) {
  const s1 = cross(a, b, c);
  const s2 = cross(a, b, d);
  const s3 = cross(c, d, a);
  const s4 = cross(c, d, b);
  const opposite = (u, v) => (u > EPS && v < -EPS) || (u < -EPS && v > EPS);
  return (opposite(s1, s2) && opposite(s3, s4)) ||
    onSegment(a, b, c) || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function pointSegmentDistance(p, a, b) {
  const dx = b[0] - a[0];
  const dy = b[1] - a[1];
  const denominator = dx * dx + dy * dy;
  if (!denominator) return distance(p, a);
  const t = Math.max(0, Math.min(1, ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / denominator));
  return length2d(p[0] - a[0] - t * dx, p[1] - a[1] - t * dy);
}

function validatePolygon(points, bevelClearance = 0, separation = 0.001) {
  let twiceArea = 0;
  const n = points.length;
  for (let i = 0; i < n; i += 1) {
    const a = points[i];
    const b = points[(i + 1) % n];
    const prev = points[(i + n - 1) % n];
    const length = distance(a, b);
    const previousLength = distance(a, prev);
    if (length < separation || previousLength < separation) {
      throw new Error('O contorno contém pontos repetidos ou próximos demais.');
    }
    twiceArea += a[0] * b[1] - a[1] * b[0];
    const dot = (prev[0] - a[0]) * (b[0] - a[0]) + (prev[1] - a[1]) * (b[1] - a[1]);
    if (Math.abs(cross(prev, a, b)) <= EPS && dot > 0) {
      throw new Error('O contorno contém arestas sobrepostas.');
    }
    if (bevelClearance) {
      const sineHalf = Math.sqrt(Math.max(0, (1 - dot / (length * previousLength)) / 2));
      if (Math.min(length, previousLength) * sineHalf <= bevelClearance + EPS) {
        throw new Error('Reduza o tamanho do chanfro para manter folga entre as arestas.');
      }
    }
    for (let j = i + 2; j < n; j += 1) {
      if (i === 0 && j === n - 1) continue;
      const c = points[j];
      const d = points[(j + 1) % n];
      if (intersects(a, b, c, d)) throw new Error('O contorno não pode se cruzar nem tocar a si mesmo.');
      if (bevelClearance && Math.min(pointSegmentDistance(a, c, d), pointSegmentDistance(b, c, d),
        pointSegmentDistance(c, a, b), pointSegmentDistance(d, a, b)) <= bevelClearance + EPS) {
        throw new Error('Reduza o tamanho do chanfro para manter folga no contorno.');
      }
    }
  }
  if (Math.abs(twiceArea) < 2 * MIN_AREA) throw new Error('A área do contorno é insuficiente.');
}

function roundOutline(points, segments) {
  return points.flatMap((point, index) => {
    const start = mix(point, points.at(index - 1));
    const end = mix(point, points[(index + 1) % points.length]);
    return Array.from({ length: segments + 1 }, (_, i) => {
      const t = i / segments;
      const s = 1 - t;
      return point.map((value, axis) => s * s * start[axis] + 2 * s * t * value + t * t * end[axis]);
    });
  });
}

export function describeModelingGeometry(type, info, p, overrides, budget) {
  const points = readPoints(type, info, overrides);
  const encoded = encodeModelingPoints(points);
  const pointKeys = overrides && Object.keys(overrides).filter((key) => !Object.hasOwn(p, key));
  if (pointKeys?.some((key) => !Object.hasOwn(encoded, key)) || (pointKeys?.length && !Object.hasOwn(overrides, 'pointCount'))) {
    throw new Error('O descritor deve informar a quantidade e os pares de coordenadas dos pontos.');
  }
  const defaults = info.presets[info.defaultPreset].points;
  const pointOverrides = points.length === defaults.length &&
    points.every((point, i) => distance(point, defaults[i]) < EPS) ? null : encoded;
  if (type === 'lathe') {
    if (points.some(([radius, height], i) => radius < 0 ||
        (i > 0 && height - points[i - 1][1] < 0.01 - EPS) ||
        (i > 0 && i < points.length - 1 && radius < 0.01)) ||
        Math.max(...points.map(([radius]) => radius)) < 0.05) {
      throw new Error('Use alturas crescentes e raios positivos. Só as extremidades podem tocar o eixo.');
    }
    const vertices = (p.radialSegments + 1) * points.length;
    const triangles = 2 * p.radialSegments * (points.length - 1);
    validateBudget(vertices, triangles, budget);
    const radius = Math.max(...points.map(([r]) => r));
    const centerY = (points[0][1] + points.at(-1)[1]) / 2;
    return { points, outline: points, pointOverrides, center: [0, centerY, 0],
      halfSize: new THREE.Vector3(radius, (points.at(-1)[1] - points[0][1]) / 2, radius) };
  }

  const outlineCount = points.length * (p.rounded ? p.curveSegments + 1 : 1);
  const layers = p.depthSegments + (p.bevelEnabled ? 2 * p.bevelSegments : 0);
  const triangles = 2 * (outlineCount - 2) + 2 * outlineCount * layers;
  validateBudget(3 * triangles, triangles, budget);
  validatePolygon(points);
  const outline = p.rounded ? roundOutline(points, p.curveSegments) : points;
  const bevel = p.bevelEnabled ? Math.SQRT2 * p.bevelSize : 0;
  if (p.rounded || bevel) validatePolygon(outline, 2 * bevel, 0.00001);
  const min = [0, 1].map((axis) => Math.min(...points.map((point) => point[axis])));
  const max = [0, 1].map((axis) => Math.max(...points.map((point) => point[axis])));
  return {
    points, outline, pointOverrides,
    center: [(min[0] + max[0]) / 2, (min[1] + max[1]) / 2, p.depth / 2],
    halfSize: new THREE.Vector3((max[0] - min[0]) / 2 + bevel, (max[1] - min[1]) / 2 + bevel,
      p.depth / 2 + (p.bevelEnabled ? p.bevelThickness : 0)),
  };
}

function validateBudget(vertices, triangles, budget) {
  if (vertices > budget.vertices || triangles > budget.triangles) {
    throw new Error('Reduza a quantidade de pontos ou segmentos para respeitar o orçamento da malha.');
  }
}

export function createModelingGeometry({ type, parameters: p, model }) {
  const [x, y, z] = model.center;
  if (type === 'lathe') {
    return new THREE.LatheGeometry(model.points.map(([radius, height]) => new THREE.Vector2(radius, height - y)),
      p.radialSegments, THREE.MathUtils.degToRad(p.startAngle), THREE.MathUtils.degToRad(p.sweepAngle));
  }
  const shape = new THREE.Shape();
  model.outline.forEach(([px, py], i) => shape[i === 0 ? 'moveTo' : 'lineTo'](px - x, py - y));
  shape.closePath();
  return new THREE.ExtrudeGeometry(shape, {
    depth: p.depth, steps: p.depthSegments, curveSegments: p.curveSegments,
    bevelEnabled: Boolean(p.bevelEnabled), bevelThickness: p.bevelThickness,
    bevelSize: p.bevelSize, bevelSegments: p.bevelSegments,
  }).translate(0, 0, -z);
}
