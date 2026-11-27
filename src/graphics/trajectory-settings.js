import { WORKSPACE_LIMIT, WORKSPACE_HEIGHT, BOUNDS_EPSILON } from './scene-assets.js';

export const TRAJECTORY_TYPES = {
  circle: 'Circular', ellipse: 'Elíptica', helix: 'Helicoidal',
  bezier: 'Bézier cúbica', catmull: 'Catmull-Rom',
};
export const MAX_CONTROL_POINTS = 8;
export const DEFAULT_TRAJECTORY = {
  enabled: false, type: 'circle', duration: 6, reverse: false, mode: 'loop',
  plane: 'xz', radius: 1, radiusB: 0.6, height: 2, turns: 2, orient: false, points: null,
};
const defaultPoints = [
  { x: -1, y: 0, z: 0 }, { x: -0.5, y: 0.5, z: 1 },
  { x: 0.5, y: 0.5, z: -1 }, { x: 1, y: 0, z: 0 },
];
const axes = ['x', 'y', 'z'];

export function normalizeTrajectory(input) {
  if (input == null) return null;
  const invalid = () => { throw new Error('Parâmetros da trajetória inválidos.'); };
  if (typeof input !== 'object' || Array.isArray(input)) invalid();
  const { enabled, type, duration, reverse, mode, plane, radius, radiusB, height, turns, orient, points } =
    { ...DEFAULT_TRAJECTORY, ...input };
  const within = (n, min, max) => Number.isFinite(n) && n >= min && n <= max;
  if (!Object.hasOwn(TRAJECTORY_TYPES, type) || !['once', 'loop', 'pingpong'].includes(mode) ||
      !['xy', 'xz', 'yz'].includes(plane) || ![enabled, reverse, orient].every((v) => typeof v === 'boolean') ||
      !within(duration, 0.5, 120) || !within(radius, 0.05, 8) || !within(radiusB, 0.05, 8) ||
      !within(height, -8, 8) || !within(turns, 1, 8) || !Number.isInteger(turns)) invalid();
  const spline = type === 'bezier' || type === 'catmull';
  const controls = spline ? points ?? defaultPoints : points;
  if (controls !== null && (!Array.isArray(controls) || controls.length < 2 ||
      controls.length > MAX_CONTROL_POINTS || (type === 'bezier' && controls.length !== 4) ||
      controls.some((p) => !p || !axes.every((k) => within(p[k], -8, 8))))) invalid();
  if (spline && !controls.some((p) => Math.hypot(...axes.map((k) => p[k] - controls[0][k])) >= 1e-4)) {
    throw new Error('A trajetória precisa de pelo menos duas posições distintas.');
  }
  return {
    enabled, type, duration, reverse, mode, plane, radius, radiusB, height, turns, orient,
    points: spline ? controls.map(({ x, y, z }) => ({ x, y, z })) : null,
  };
}

export function sameTrajectory(a, b) {
  if (a === b) return true;
  if (!a || !b) return (a ?? null) === (b ?? null);
  return Object.keys(DEFAULT_TRAJECTORY).every((key) => key === 'points' || a[key] === b[key]) &&
    (a.points?.length ?? 0) === (b.points?.length ?? 0) &&
    (a.points ?? []).every((point, i) => axes.every((axis) => point[axis] === b.points[i][axis]));
}

export function trajectoryFits(settings, position, extents, rotationFreeRadius) {
  if (!settings?.enabled) return true;
  const { type, plane, radius, radiusB, height, points } = settings;
  return axes.every((axis, index) => {
    let min;
    let max;
    if (points) {
      const hull = points.map((point) => point[axis]);
      if (type === 'catmull') {
        for (let i = 0; i < points.length - 1; i += 1) {
          const a = hull[i];
          const b = hull[i + 1];
          const previous = i ? hull[i - 1] : 2 * a - b;
          const next = i + 2 < points.length ? hull[i + 2] : 2 * b - a;
          hull.push(a + (b - previous) / 6, b - (next - a) / 6);
        }
      }
      min = Math.min(...hull);
      max = Math.max(...hull);
    } else {
      const planeIndex = plane.indexOf(axis);
      const reach = planeIndex === 0 ? radius : (type === 'ellipse' ? radiusB : radius);
      const rise = type === 'helix' ? height : 0;
      min = planeIndex < 0 ? Math.min(0, rise) : -reach;
      max = planeIndex < 0 ? Math.max(0, rise) : reach;
    }
    const extent = rotationFreeRadius ?? extents[axis];
    const low = index === 1 ? 0 : -WORKSPACE_LIMIT;
    const high = index === 1 ? WORKSPACE_HEIGHT : WORKSPACE_LIMIT;
    return position[axis] + min - extent >= low - BOUNDS_EPSILON &&
      position[axis] + max + extent <= high + BOUNDS_EPSILON;
  });
}
