/**
 * Minimal WebGL mesh renderer for the viewer page: flat-shaded triangles with
 * a two-light headlamp model, optional wireframe overlay, a Z=0 grid, and an
 * orbit camera (drag = rotate, wheel = zoom, right-drag / shift-drag = pan).
 * No dependencies; ~250 lines. All math lives in core/viewer-math.ts.
 */
import {
  buildGrid,
  buildWireframe,
  clampOrbit,
  computeBounds,
  computeFlatNormals,
  fitOrbit,
  gridStepFor,
  orbitEye,
  panDelta,
  viewProjection,
  type Bounds,
  type OrbitState,
} from '../core/viewer-math';

const FOV_Y = (40 * Math.PI) / 180;

const VERT = `
attribute vec3 aPos;
attribute vec3 aNrm;
uniform mat4 uVP;
varying vec3 vNrm;
varying vec3 vPos;
void main() {
  vNrm = aNrm;
  vPos = aPos;
  gl_Position = uVP * vec4(aPos, 1.0);
}`;

const FRAG = `
precision mediump float;
uniform vec3 uEye;
uniform vec3 uColor;
uniform float uFlat;
varying vec3 vNrm;
varying vec3 vPos;
void main() {
  if (uFlat > 0.5) { gl_FragColor = vec4(uColor, 1.0); return; }
  vec3 n = normalize(vNrm);
  vec3 toEye = normalize(uEye - vPos);
  // Two-sided lighting so inside-out faces still read as surfaces.
  float facing = dot(n, toEye);
  if (facing < 0.0) n = -n;
  vec3 key = normalize(vec3(0.4, -0.6, 0.7));
  vec3 fill = normalize(vec3(-0.6, 0.3, 0.2));
  float diff = max(dot(n, key), 0.0) * 0.75 + max(dot(n, fill), 0.0) * 0.25;
  float rim = pow(1.0 - max(abs(facing), 0.0), 2.0) * 0.15;
  vec3 c = uColor * (0.28 + 0.72 * diff) + rim;
  if (facing < 0.0) c = mix(c, vec3(0.85, 0.35, 0.1), 0.6); // back faces tinted
  gl_FragColor = vec4(c, 1.0);
}`;

export interface ViewerOptions {
  color?: [number, number, number];
  background?: [number, number, number];
}

export class MeshViewer {
  private gl: WebGLRenderingContext;
  private program: WebGLProgram;
  private aPos: number;
  private aNrm: number;
  private uVP: WebGLUniformLocation;
  private uEye: WebGLUniformLocation;
  private uColor: WebGLUniformLocation;
  private uFlat: WebGLUniformLocation;

  private posBuf: WebGLBuffer;
  private nrmBuf: WebGLBuffer;
  private wireBuf: WebGLBuffer;
  private gridBuf: WebGLBuffer;
  private triCount = 0;
  private wireCount = 0;
  private gridCount = 0;

  private bounds: Bounds | null = null;
  private orbit: OrbitState | null = null;
  private dirty = true;
  private raf = 0;

  showWireframe = false;
  showGrid = true;
  private color: [number, number, number];
  private background: [number, number, number];

  constructor(private canvas: HTMLCanvasElement, options: ViewerOptions = {}) {
    const gl = canvas.getContext('webgl', { antialias: true, preserveDrawingBuffer: true });
    if (!gl) throw new Error('WebGL is not available in this browser.');
    this.gl = gl;
    this.color = options.color ?? [0.86, 0.33, 0.1];
    this.background = options.background ?? [0.08, 0.08, 0.075];

    this.program = this.link(VERT, FRAG);
    this.aPos = gl.getAttribLocation(this.program, 'aPos');
    this.aNrm = gl.getAttribLocation(this.program, 'aNrm');
    this.uVP = gl.getUniformLocation(this.program, 'uVP')!;
    this.uEye = gl.getUniformLocation(this.program, 'uEye')!;
    this.uColor = gl.getUniformLocation(this.program, 'uColor')!;
    this.uFlat = gl.getUniformLocation(this.program, 'uFlat')!;
    this.posBuf = gl.createBuffer()!;
    this.nrmBuf = gl.createBuffer()!;
    this.wireBuf = gl.createBuffer()!;
    this.gridBuf = gl.createBuffer()!;

    gl.enable(gl.DEPTH_TEST);
    gl.clearColor(this.background[0], this.background[1], this.background[2], 1);
    this.bindEvents();
    this.loop();
  }

  private link(vs: string, fs: string): WebGLProgram {
    const gl = this.gl;
    const compile = (type: number, src: string) => {
      const sh = gl.createShader(type)!;
      gl.shaderSource(sh, src);
      gl.compileShader(sh);
      if (!gl.getShaderParameter(sh, gl.COMPILE_STATUS)) throw new Error(gl.getShaderInfoLog(sh) ?? 'shader error');
      return sh;
    };
    const p = gl.createProgram()!;
    gl.attachShader(p, compile(gl.VERTEX_SHADER, vs));
    gl.attachShader(p, compile(gl.FRAGMENT_SHADER, fs));
    gl.linkProgram(p);
    if (!gl.getProgramParameter(p, gl.LINK_STATUS)) throw new Error(gl.getProgramInfoLog(p) ?? 'link error');
    return p;
  }

  setMesh(positions: Float32Array): Bounds {
    const gl = this.gl;
    const normals = computeFlatNormals(positions);
    const wire = buildWireframe(positions);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.bufferData(gl.ARRAY_BUFFER, normals, gl.STATIC_DRAW);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBuf);
    gl.bufferData(gl.ARRAY_BUFFER, wire, gl.STATIC_DRAW);
    this.triCount = positions.length / 3;
    this.wireCount = wire.length / 3;

    this.bounds = computeBounds(positions);
    const grid = buildGrid(this.bounds, gridStepFor(this.bounds));
    gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
    gl.bufferData(gl.ARRAY_BUFFER, grid, gl.STATIC_DRAW);
    this.gridCount = grid.length / 3;

    this.resetView();
    return this.bounds;
  }

  resetView(): void {
    if (!this.bounds) return;
    this.orbit = fitOrbit(this.bounds, FOV_Y, this.aspect());
    this.dirty = true;
  }

  /** Preset views: top / front / right / iso. */
  setView(preset: 'iso' | 'top' | 'front' | 'right'): void {
    if (!this.bounds || !this.orbit) return;
    const base = fitOrbit(this.bounds, FOV_Y, this.aspect());
    const e = Math.PI / 2 - 0.02;
    const presets = {
      iso: { azimuth: -Math.PI / 4, elevation: Math.PI / 7 },
      top: { azimuth: -Math.PI / 2, elevation: e },
      front: { azimuth: -Math.PI / 2, elevation: 0 },
      right: { azimuth: 0, elevation: 0 },
    } as const;
    this.orbit = { ...base, ...presets[preset], distance: this.orbit.distance };
    this.dirty = true;
  }

  invalidate(): void {
    this.dirty = true;
  }

  private aspect(): number {
    return this.canvas.width / Math.max(1, this.canvas.height);
  }

  private resizeToDisplay(): void {
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(1, Math.floor(this.canvas.clientWidth * dpr));
    const h = Math.max(1, Math.floor(this.canvas.clientHeight * dpr));
    if (this.canvas.width !== w || this.canvas.height !== h) {
      this.canvas.width = w;
      this.canvas.height = h;
      this.gl.viewport(0, 0, w, h);
      this.dirty = true;
    }
  }

  private loop = (): void => {
    this.resizeToDisplay();
    if (this.dirty) {
      this.draw();
      this.dirty = false;
    }
    this.raf = requestAnimationFrame(this.loop);
  };

  destroy(): void {
    cancelAnimationFrame(this.raf);
  }

  private draw(): void {
    const gl = this.gl;
    gl.clear(gl.COLOR_BUFFER_BIT | gl.DEPTH_BUFFER_BIT);
    if (!this.bounds || !this.orbit) return;

    const vp = viewProjection(this.orbit, this.aspect(), FOV_Y, this.bounds.radius);
    const eye = orbitEye(this.orbit);
    gl.useProgram(this.program);
    gl.uniformMatrix4fv(this.uVP, false, vp);
    gl.uniform3f(this.uEye, eye[0], eye[1], eye[2]);

    // Grid
    if (this.showGrid && this.gridCount) {
      gl.uniform1f(this.uFlat, 1);
      gl.uniform3f(this.uColor, 0.22, 0.22, 0.21);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.gridBuf);
      gl.enableVertexAttribArray(this.aPos);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(this.aNrm);
      gl.vertexAttrib3f(this.aNrm, 0, 0, 1);
      gl.drawArrays(gl.LINES, 0, this.gridCount);
    }

    // Solid
    gl.uniform1f(this.uFlat, 0);
    gl.uniform3f(this.uColor, this.color[0], this.color[1], this.color[2]);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.posBuf);
    gl.enableVertexAttribArray(this.aPos);
    gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
    gl.bindBuffer(gl.ARRAY_BUFFER, this.nrmBuf);
    gl.enableVertexAttribArray(this.aNrm);
    gl.vertexAttribPointer(this.aNrm, 3, gl.FLOAT, false, 0, 0);
    gl.enable(gl.POLYGON_OFFSET_FILL);
    gl.polygonOffset(1, 1);
    gl.drawArrays(gl.TRIANGLES, 0, this.triCount);
    gl.disable(gl.POLYGON_OFFSET_FILL);

    // Wireframe
    if (this.showWireframe && this.wireCount) {
      gl.uniform1f(this.uFlat, 1);
      gl.uniform3f(this.uColor, 0.95, 0.95, 0.93);
      gl.bindBuffer(gl.ARRAY_BUFFER, this.wireBuf);
      gl.vertexAttribPointer(this.aPos, 3, gl.FLOAT, false, 0, 0);
      gl.disableVertexAttribArray(this.aNrm);
      gl.drawArrays(gl.LINES, 0, this.wireCount);
    }
  }

  private bindEvents(): void {
    const c = this.canvas;
    let dragging: 'rotate' | 'pan' | null = null;
    let lastX = 0, lastY = 0;
    let pinchDist = 0;

    const down = (x: number, y: number, mode: 'rotate' | 'pan') => { dragging = mode; lastX = x; lastY = y; };
    const move = (x: number, y: number) => {
      if (!dragging || !this.orbit || !this.bounds) return;
      const dx = x - lastX, dy = y - lastY;
      lastX = x; lastY = y;
      if (dragging === 'rotate') {
        this.orbit = clampOrbit(
          { ...this.orbit, azimuth: this.orbit.azimuth - dx * 0.008, elevation: this.orbit.elevation + dy * 0.008 },
          this.bounds.radius * 0.05, this.bounds.radius * 50
        );
      } else {
        const d = panDelta(this.orbit, dx, dy, c.clientHeight, FOV_Y);
        this.orbit = { ...this.orbit, target: [this.orbit.target[0] + d[0], this.orbit.target[1] + d[1], this.orbit.target[2] + d[2]] };
      }
      this.dirty = true;
    };
    const up = () => { dragging = null; };

    c.addEventListener('mousedown', (e) => { e.preventDefault(); down(e.clientX, e.clientY, e.button === 2 || e.shiftKey ? 'pan' : 'rotate'); });
    window.addEventListener('mousemove', (e) => move(e.clientX, e.clientY));
    window.addEventListener('mouseup', up);
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    c.addEventListener('wheel', (e) => {
      e.preventDefault();
      if (!this.orbit || !this.bounds) return;
      const factor = Math.exp(e.deltaY * 0.0015);
      this.orbit = clampOrbit({ ...this.orbit, distance: this.orbit.distance * factor }, this.bounds.radius * 0.05, this.bounds.radius * 50);
      this.dirty = true;
    }, { passive: false });

    c.addEventListener('touchstart', (e) => {
      if (e.touches.length === 1) down(e.touches[0].clientX, e.touches[0].clientY, 'rotate');
      else if (e.touches.length === 2) {
        dragging = 'pan';
        lastX = (e.touches[0].clientX + e.touches[1].clientX) / 2;
        lastY = (e.touches[0].clientY + e.touches[1].clientY) / 2;
        pinchDist = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
      }
    }, { passive: true });
    c.addEventListener('touchmove', (e) => {
      e.preventDefault();
      if (e.touches.length === 1) move(e.touches[0].clientX, e.touches[0].clientY);
      else if (e.touches.length === 2 && this.orbit && this.bounds) {
        const d = Math.hypot(e.touches[0].clientX - e.touches[1].clientX, e.touches[0].clientY - e.touches[1].clientY);
        if (pinchDist > 0) {
          this.orbit = clampOrbit({ ...this.orbit, distance: this.orbit.distance * (pinchDist / d) }, this.bounds.radius * 0.05, this.bounds.radius * 50);
        }
        pinchDist = d;
        move((e.touches[0].clientX + e.touches[1].clientX) / 2, (e.touches[0].clientY + e.touches[1].clientY) / 2);
      }
    }, { passive: false });
    c.addEventListener('touchend', up);
  }

  /** PNG snapshot of the current frame. */
  snapshotDataUrl(): string {
    this.draw();
    return this.canvas.toDataURL('image/png');
  }
}
