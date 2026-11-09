/**
 * Camera and geometry math for the mesh viewer, kept free of WebGL so it can
 * be unit-tested. The renderer in src/viewer/webgl.ts consumes these.
 *
 * Conventions: right-handed, Z up (printer bed convention). Column-major
 * 4×4 matrices as Float32Array(16), matching WebGL uniformMatrix4fv.
 */

export type Mat4 = Float32Array;

export interface Bounds {
  min: [number, number, number];
  max: [number, number, number];
  center: [number, number, number];
  size: [number, number, number];
  radius: number;
}

export function computeBounds(positions: Float32Array): Bounds {
  let minX = Infinity, minY = Infinity, minZ = Infinity;
  let maxX = -Infinity, maxY = -Infinity, maxZ = -Infinity;
  for (let i = 0; i < positions.length; i += 3) {
    const x = positions[i], y = positions[i + 1], z = positions[i + 2];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (y < minY) minY = y; if (y > maxY) maxY = y;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  if (!Number.isFinite(minX)) {
    return { min: [0, 0, 0], max: [0, 0, 0], center: [0, 0, 0], size: [0, 0, 0], radius: 1 };
  }
  const size: [number, number, number] = [maxX - minX, maxY - minY, maxZ - minZ];
  const center: [number, number, number] = [(minX + maxX) / 2, (minY + maxY) / 2, (minZ + maxZ) / 2];
  const radius = Math.max(1e-6, Math.hypot(size[0], size[1], size[2]) / 2);
  return { min: [minX, minY, minZ], max: [maxX, maxY, maxZ], center, size, radius };
}

/** Flat per-face normals, one per vertex (3 identical per triangle). */
export function computeFlatNormals(positions: Float32Array): Float32Array {
  const normals = new Float32Array(positions.length);
  for (let i = 0; i < positions.length; i += 9) {
    const ax = positions[i], ay = positions[i + 1], az = positions[i + 2];
    const ux = positions[i + 3] - ax, uy = positions[i + 4] - ay, uz = positions[i + 5] - az;
    const vx = positions[i + 6] - ax, vy = positions[i + 7] - ay, vz = positions[i + 8] - az;
    let nx = uy * vz - uz * vy, ny = uz * vx - ux * vz, nz = ux * vy - uy * vx;
    const len = Math.hypot(nx, ny, nz) || 1;
    nx /= len; ny /= len; nz /= len;
    for (let k = 0; k < 9; k += 3) {
      normals[i + k] = nx; normals[i + k + 1] = ny; normals[i + k + 2] = nz;
    }
  }
  return normals;
}

/** Edge list (2 vertices per edge, 3 edges per triangle) for wireframe overlay. */
export function buildWireframe(positions: Float32Array): Float32Array {
  const out = new Float32Array(positions.length * 2);
  let o = 0;
  for (let i = 0; i < positions.length; i += 9) {
    for (let e = 0; e < 3; e++) {
      const a = i + e * 3, b = i + ((e + 1) % 3) * 3;
      out[o++] = positions[a]; out[o++] = positions[a + 1]; out[o++] = positions[a + 2];
      out[o++] = positions[b]; out[o++] = positions[b + 1]; out[o++] = positions[b + 2];
    }
  }
  return out;
}

export function perspective(fovYRad: number, aspect: number, near: number, far: number): Mat4 {
  const f = 1 / Math.tan(fovYRad / 2);
  const nf = 1 / (near - far);
  const m = new Float32Array(16);
  m[0] = f / aspect;
  m[5] = f;
  m[10] = (far + near) * nf;
  m[11] = -1;
  m[14] = 2 * far * near * nf;
  return m;
}

function normalize3(v: [number, number, number]): [number, number, number] {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
function cross3(a: [number, number, number], b: [number, number, number]): [number, number, number] {
  return [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]];
}
function dot3(a: [number, number, number], b: [number, number, number]): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function lookAt(eye: [number, number, number], target: [number, number, number], up: [number, number, number]): Mat4 {
  const z = normalize3([eye[0] - target[0], eye[1] - target[1], eye[2] - target[2]]);
  let x = normalize3(cross3(up, z));
  if (!Number.isFinite(x[0]) || Math.hypot(...x) < 1e-6) x = [1, 0, 0];
  const y = cross3(z, x);
  const m = new Float32Array(16);
  m[0] = x[0]; m[4] = x[1]; m[8] = x[2]; m[12] = -dot3(x, eye);
  m[1] = y[0]; m[5] = y[1]; m[9] = y[2]; m[13] = -dot3(y, eye);
  m[2] = z[0]; m[6] = z[1]; m[10] = z[2]; m[14] = -dot3(z, eye);
  m[15] = 1;
  return m;
}

export function multiply(a: Mat4, b: Mat4): Mat4 {
  const out = new Float32Array(16);
  for (let c = 0; c < 4; c++) {
    for (let r = 0; r < 4; r++) {
      out[c * 4 + r] = a[r] * b[c * 4] + a[4 + r] * b[c * 4 + 1] + a[8 + r] * b[c * 4 + 2] + a[12 + r] * b[c * 4 + 3];
    }
  }
  return out;
}

export function transformPoint(m: Mat4, p: [number, number, number]): [number, number, number, number] {
  return [
    m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
    m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
    m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
  ];
}

/** Orbit camera around a target, Z up. Angles in radians. */
export interface OrbitState {
  target: [number, number, number];
  distance: number;
  /** Rotation around Z. */
  azimuth: number;
  /** Elevation above the XY plane, clamped to avoid the poles. */
  elevation: number;
}

const MAX_ELEVATION = Math.PI / 2 - 0.01;

export function clampOrbit(s: OrbitState, minDistance: number, maxDistance: number): OrbitState {
  return {
    ...s,
    distance: Math.min(maxDistance, Math.max(minDistance, s.distance)),
    elevation: Math.min(MAX_ELEVATION, Math.max(-MAX_ELEVATION, s.elevation)),
  };
}

export function orbitEye(s: OrbitState): [number, number, number] {
  const ce = Math.cos(s.elevation);
  return [
    s.target[0] + s.distance * ce * Math.cos(s.azimuth),
    s.target[1] + s.distance * ce * Math.sin(s.azimuth),
    s.target[2] + s.distance * Math.sin(s.elevation),
  ];
}

/** Initial orbit that frames the bounds in a given vertical FOV. */
export function fitOrbit(b: Bounds, fovYRad: number, aspect: number): OrbitState {
  const fovX = 2 * Math.atan(Math.tan(fovYRad / 2) * aspect);
  const limiting = Math.min(fovYRad, fovX);
  const distance = (b.radius / Math.sin(limiting / 2)) * 1.05;
  return { target: b.center, distance, azimuth: -Math.PI / 4, elevation: Math.PI / 7 };
}

export function viewProjection(s: OrbitState, aspect: number, fovYRad: number, radius: number): Mat4 {
  const eye = orbitEye(s);
  const near = Math.max(radius * 1e-3, s.distance - radius * 4);
  const far = s.distance + radius * 4;
  return multiply(perspective(fovYRad, aspect, Math.max(near, 1e-4), far), lookAt(eye, s.target, [0, 0, 1]));
}

/** Converts a screen-space drag (pixels) into a target pan in world units. */
export function panDelta(s: OrbitState, dxPx: number, dyPx: number, viewportHeightPx: number, fovYRad: number): [number, number, number] {
  const worldPerPx = (2 * s.distance * Math.tan(fovYRad / 2)) / viewportHeightPx;
  const eye = orbitEye(s);
  const forward = normalize3([s.target[0] - eye[0], s.target[1] - eye[1], s.target[2] - eye[2]]);
  const right = normalize3(cross3(forward, [0, 0, 1]));
  const up = cross3(right, forward);
  return [
    (-dxPx * right[0] + dyPx * up[0]) * worldPerPx,
    (-dxPx * right[1] + dyPx * up[1]) * worldPerPx,
    (-dxPx * right[2] + dyPx * up[2]) * worldPerPx,
  ];
}

/** Grid lines on Z = 0 covering the model footprint, as line-segment pairs. */
export function buildGrid(b: Bounds, step: number): Float32Array {
  const ext = Math.max(b.size[0], b.size[1], step * 4) * 0.75 + step;
  const cx = b.center[0], cy = b.center[1];
  const start = -Math.ceil(ext / step) * step;
  const n = Math.round((2 * -start) / step) + 1;
  const out = new Float32Array(n * 2 * 6);
  let o = 0;
  for (let i = 0; i < n; i++) {
    const t = start + i * step;
    out[o++] = cx + t; out[o++] = cy + start; out[o++] = 0;
    out[o++] = cx + t; out[o++] = cy - start; out[o++] = 0;
    out[o++] = cx + start; out[o++] = cy + t; out[o++] = 0;
    out[o++] = cx - start; out[o++] = cy + t; out[o++] = 0;
  }
  return out;
}

/** Picks a round grid step (1, 2, 5, 10, 20, 50 …) so there are ~10–25 lines. */
export function gridStepFor(b: Bounds): number {
  const span = Math.max(b.size[0], b.size[1], 1);
  const raw = span / 12;
  const pow = Math.pow(10, Math.floor(Math.log10(raw)));
  const m = raw / pow;
  const nice = m < 1.5 ? 1 : m < 3.5 ? 2 : m < 7.5 ? 5 : 10;
  return nice * pow;
}
