import * as THREE from 'three';

const forward = new THREE.Vector3(0, 0, 1);
const normalAxis = { xy: 'z', xz: 'y', yz: 'x' };

class ParametricTrajectory extends THREE.Curve {
  constructor(settings) {
    super();
    this.settings = settings;
  }

  getPoint(t, target = new THREE.Vector3()) {
    const { type, plane, radius, radiusB, turns, height } = this.settings;
    const angle = 2 * Math.PI * t * (type === 'helix' ? turns : 1);
    target[plane[0]] = radius * Math.cos(angle);
    target[plane[1]] = (type === 'ellipse' ? radiusB : radius) * Math.sin(angle);
    target[normalAxis[plane]] = type === 'helix' ? height * t : 0;
    return target;
  }

  getTangent(t, target = new THREE.Vector3()) {
    const { type, plane, radius, radiusB, turns, height } = this.settings;
    const angularRate = 2 * Math.PI * (type === 'helix' ? turns : 1);
    const angle = angularRate * t;
    target[plane[0]] = -radius * Math.sin(angle) * angularRate;
    target[plane[1]] = (type === 'ellipse' ? radiusB : radius) * Math.cos(angle) * angularRate;
    target[normalAxis[plane]] = type === 'helix' ? height : 0;
    return target.normalize();
  }
}

export function createTrajectoryCurve(settings) {
  let curve;
  if (settings.points) {
    const points = settings.points.map(({ x, y, z }) => new THREE.Vector3(x, y, z));
    curve = settings.type === 'bezier'
      ? new THREE.CubicBezierCurve3(...points)
      : points.length === 2
        ? new THREE.LineCurve3(...points)
        : new THREE.CatmullRomCurve3(points, false, 'catmullrom', 0.5);
  } else {
    curve = new ParametricTrajectory(settings);
  }
  curve.arcLengthDivisions = 512;
  curve.getLengths();
  return curve;
}

export function createTrajectoryMotion(settings) {
  return {
    settings,
    curve: createTrajectoryCurve(settings),
    elapsed: 0,
    paused: false,
  };
}

export function trajectoryProgress({ settings, elapsed }, target = {}) {
  const { duration, reverse, mode } = settings;
  const cycle = elapsed / duration;
  const returning = mode === 'pingpong' && cycle >= 1;
  const phase = mode === 'once' ? Math.min(cycle, 1) : returning ? 2 - cycle : cycle;
  target.u = reverse ? 1 - phase : phase;
  target.backwards = reverse !== returning;
  return target;
}

export function advanceTrajectory(motion, delta) {
  if (!motion || motion.paused) return;
  const { duration, mode } = motion.settings;
  const elapsed = motion.elapsed + delta;
  motion.elapsed = mode === 'once'
    ? Math.min(duration, elapsed)
    : elapsed % (duration * (mode === 'pingpong' ? 2 : 1));
}

export function createTrajectoryPose() {
  const offset = new THREE.Vector3();
  const tangent = new THREE.Vector3();
  const orientation = new THREE.Quaternion();
  const spin = new THREE.Quaternion();
  const axis = new THREE.Vector3();
  const start = new THREE.Vector3();
  const baseForward = new THREE.Vector3();
  const progress = {};
  return (entity, motion) => {
    const { mesh, animation } = entity;
    const { settings, curve } = motion;
    const { u, backwards } = trajectoryProgress(motion, progress);
    const t = u === 0 || u === 1 ? u : curve.getUtoTmapping(u);
    mesh.position.add(curve.getPoint(t, offset));
    if (settings.orient) {
      if (curve instanceof ParametricTrajectory) {
        curve.getTangent(t, tangent);
      } else {
        // Keep the base orientation when the local chord cannot define a direction.
        curve.getPoint(Math.max(0, t - 0.0001), start);
        curve.getPoint(Math.min(1, t + 0.0001), tangent).sub(start);
      }
      if (tangent.lengthSq() > 1e-14) {
        tangent.normalize();
        if (backwards) tangent.negate();
        baseForward.copy(forward).applyQuaternion(mesh.quaternion);
        mesh.quaternion.premultiply(orientation.setFromUnitVectors(baseForward, tangent));
      }
    }
    if (animation.enabled) {
      axis.set(0, 0, 0);
      axis[animation.axis] = 1;
      mesh.quaternion.multiply(spin.setFromAxisAngle(axis, entity.rotationPhase));
    }
  };
}
