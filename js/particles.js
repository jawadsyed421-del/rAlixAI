// rAlix AI — particle engine
// Turns any image (or generated shape) into a 3D point cloud with depth,
// mouse repulsion, data-streak drift, row glitches and morphing.
import * as THREE from 'three';

const VERT = /* glsl */ `
uniform float uTime;
uniform float uIntro;
uniform float uSize;
uniform float uScale;
uniform float uMorph;
uniform float uGlitch;
uniform float uDrift;
uniform vec2  uMouse;
uniform float uMouseR;
uniform float uMouseOn;
attribute float aLum;
attribute vec4  aRnd;
attribute vec3  aAlt;
varying float vLum;
varying float vAlpha;

float hash(float n){ return fract(sin(n) * 43758.5453123); }

void main(){
  vec3 p = position;

  // slow breathing of the relief
  p.z += sin(uTime * 0.8 + p.y * 3.0 + aRnd.x * 6.2831) * 0.012;

  // data-streak drifters: a few particles stream off to the left and fade
  float drifter = step(1.0 - 0.05 * uDrift, aRnd.y);
  float dt = fract(uTime * (0.04 + aRnd.z * 0.07) + aRnd.w);
  p.x -= drifter * dt * (0.35 + aRnd.x * 1.1);
  float driftFade = 1.0 - drifter * dt;

  // occasional horizontal row glitch
  float row  = floor(p.y * 70.0);
  float tick = floor(uTime * 7.0);
  float gl   = step(0.993, hash(row * 13.17 + tick)) * uGlitch;
  p.x += gl * (hash(row + tick * 1.7) - 0.5) * 0.3;

  // mouse: push particles away and toward the camera
  vec2  d    = p.xy - uMouse;
  float dist = length(d);
  float f    = smoothstep(uMouseR, 0.0, dist) * uMouseOn;
  p.xy += normalize(d + 1e-5) * f * 0.13;
  p.z  += f * 0.3;

  // morph toward the alternate target
  float m = smoothstep(aRnd.x * 0.35, 0.65 + aRnd.x * 0.35, uMorph);
  p = mix(p, aAlt, m);

  // intro: fly in from a scattered cloud
  float t = clamp(uIntro * 1.6 - aRnd.x * 0.6, 0.0, 1.0);
  t = 1.0 - pow(1.0 - t, 3.0);
  vec3 scatter = (aRnd.xyz - 0.5) * vec3(7.0, 5.0, 5.0);
  p = mix(scatter, p, t);

  vec4 mv = modelViewMatrix * vec4(p, 1.0);
  gl_Position = projectionMatrix * mv;

  float sz = uSize * (0.35 + aLum * 0.95) * (1.0 + f * 0.9);
  gl_PointSize = max(1.0, sz * uScale / -mv.z);

  vLum   = aLum;
  vAlpha = (0.22 + aLum * 0.85) * driftFade * (0.25 + 0.75 * t) * (1.0 + gl * 1.5);
}
`;

const FRAG = /* glsl */ `
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform vec3 uColorC;
uniform float uOpacity;
varying float vLum;
varying float vAlpha;
void main(){
  vec2 c = gl_PointCoord - 0.5;
  float r = length(c);
  if (r > 0.5) discard;
  float soft = smoothstep(0.5, 0.05, r);
  vec3 col = mix(uColorA, uColorB, smoothstep(0.0, 0.55, vLum));
  col = mix(col, uColorC, smoothstep(0.72, 1.0, vLum));
  gl_FragColor = vec4(col, vAlpha * soft * uOpacity);
}
`;

/* ---------- sources ---------- */

export function loadImage(src) {
  return new Promise((resolve) => {
    if (!src) return resolve(null);
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = src;
  });
}

// Draw an image "contain"-fitted and bottom-aligned into w×h.
export function drawContain(ctx, img, w, h) {
  const s = Math.min(w / img.width, h / img.height);
  const dw = img.width * s, dh = img.height * s;
  ctx.drawImage(img, (w - dw) / 2, h - dh, dw, dh);
}

/**
 * Sample a drawing into particles.
 * draw(ctx, w, h) paints the source. Brightness × alpha → particle luminance.
 * Returns positions in a box 2 units tall, centred on the origin.
 */
export function sampleDrawing(draw, {
  cols = 190, aspect = 1.2, threshold = 0.07, contrast = 1.35,
  depth = 0.4, mask = false, maxCount = 200000, floor = 0, autoLevels = false, gamma = 1,
  sparse = true, jitter = 0.9,
} = {}) {
  const rows = Math.round(cols * aspect);
  const cv = document.createElement('canvas');
  cv.width = cols; cv.height = rows;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  draw(ctx, cols, rows);
  const data = ctx.getImageData(0, 0, cols, rows).data;

  const cell = 2 / rows;
  const W = cols * cell;
  const pos = [], lum = [];

  // Auto-levels: stretch the subject's own tonal range (5th–97th percentile of
  // visible pixels) so dark faces/hair read as clearly as bright shirts.
  let lo = 0, hi = 1;
  if (autoLevels) {
    const vals = [];
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] > 128) vals.push((0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255);
    }
    if (vals.length > 50) {
      vals.sort((a, b) => a - b);
      lo = vals[Math.floor(vals.length * 0.05)];
      hi = vals[Math.floor(vals.length * 0.97)];
      if (hi - lo < 0.05) { lo = 0; hi = 1; }
    }
  }

  for (let y = 0; y < rows; y++) {
    for (let x = 0; x < cols; x++) {
      const i = (y * cols + x) * 4;
      let l = (0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]) / 255;
      const a = data[i + 3] / 255;
      if (autoLevels) l = Math.min(1, Math.max(0, (l - lo) / (hi - lo)));
      if (gamma !== 1) l = Math.pow(l, gamma);
      l = (l * (1 - floor) + floor) * a; // floor lifts dark areas (hair, shadows) inside the subject
      if (mask) {
        const nx = (x / cols - 0.5) * 2, ny = (y / rows - 0.55) * 2;
        l *= 1 - Math.min(1, Math.max(0, (Math.hypot(nx * 0.95, ny * 0.8) - 0.7) / 0.3));
      }
      l = Math.min(1, Math.max(0, (l - 0.5) * contrast + 0.5));
      if (l < threshold) continue;
      if (sparse && l < 0.3 && Math.random() > l * 3.2) continue; // sparser in the shadows
      pos.push(
        x * cell - W / 2 + (Math.random() - 0.5) * cell * jitter,
        1 - y * cell + (Math.random() - 0.5) * cell * 0.3,
        (l - 0.5) * depth + (Math.random() - 0.5) * 0.02,
      );
      lum.push(l);
    }
  }
  let count = lum.length;
  if (count > maxCount) count = maxCount;
  return {
    positions: new Float32Array(pos.slice(0, count * 3)),
    lum: new Float32Array(lum.slice(0, count)),
    count, cellSize: cell, width: W, height: 2,
  };
}

/* ---------- procedural shapes (same particle count as needed) ---------- */

export function sphereShape(count, r = 0.95) {
  const out = new Float32Array(count * 3);
  const ga = Math.PI * (3 - Math.sqrt(5));
  for (let i = 0; i < count; i++) {
    const y = 1 - (i / (count - 1)) * 2;
    const rad = Math.sqrt(1 - y * y);
    const th = ga * i;
    const jr = r * (1 + (Math.random() - 0.5) * 0.04);
    out.set([Math.cos(th) * rad * jr, y * jr, Math.sin(th) * rad * jr], i * 3);
  }
  return out;
}

export function helixShape(count) {
  const out = new Float32Array(count * 3);
  for (let i = 0; i < count; i++) {
    const strand = i % 2;
    const t = (i / count) * Math.PI * 8;
    const y = (i / count) * 2.4 - 1.2;
    const rr = 0.45 + (Math.random() - 0.5) * 0.06;
    const a = t + strand * Math.PI;
    // occasional "rungs" between strands
    if (Math.random() < 0.18) {
      const k = Math.random() * 2 - 1;
      out.set([Math.cos(t) * rr * k, y, Math.sin(t) * rr * k], i * 3);
    } else {
      out.set([Math.cos(a) * rr, y, Math.sin(a) * rr], i * 3);
    }
  }
  return out;
}

export function waveShape(count) {
  const out = new Float32Array(count * 3);
  const side = Math.ceil(Math.sqrt(count));
  for (let i = 0; i < count; i++) {
    const gx = (i % side) / side - 0.5, gz = Math.floor(i / side) / side - 0.5;
    const x = gx * 2.8, z = gz * 2.8;
    const y = Math.sin(x * 3) * 0.18 + Math.cos(z * 4 + x) * 0.14;
    out.set([x, y - 0.1, z], i * 3);
  }
  return out;
}

export function textShape(count, text, { font = '800 160px Inter Tight, sans-serif', width = 2.6 } = {}) {
  const cv = document.createElement('canvas');
  cv.width = 900; cv.height = 260;
  const ctx = cv.getContext('2d', { willReadFrequently: true });
  ctx.fillStyle = '#fff'; ctx.font = font;
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  ctx.fillText(text, 450, 135);
  const d = ctx.getImageData(0, 0, 900, 260).data;
  const pts = [];
  for (let y = 0; y < 260; y += 2) for (let x = 0; x < 900; x += 2) if (d[(y * 900 + x) * 4 + 3] > 128) pts.push(x, y);
  const out = new Float32Array(count * 3);
  const s = width / 900;
  for (let i = 0; i < count; i++) {
    const k = Math.floor(Math.random() * (pts.length / 2)) * 2;
    out.set([(pts[k] - 450) * s + (Math.random() - 0.5) * s * 2, (130 - pts[k + 1]) * s + (Math.random() - 0.5) * s * 2, (Math.random() - 0.5) * 0.12], i * 3);
  }
  return out;
}

export function scatterShape(base, spread = 2.4) {
  const out = new Float32Array(base.length);
  for (let i = 0; i < base.length; i += 3) {
    const dx = Math.random() - 0.5, dy = Math.random() - 0.5, dz = Math.random() - 0.2;
    out[i] = base[i] * 1.6 + dx * spread * 1.6;
    out[i + 1] = base[i + 1] * 1.2 + dy * spread;
    out[i + 2] = base[i + 2] + dz * spread * 1.5;
  }
  return out;
}

/* ---------- placeholder bust (until real photos are supplied) ---------- */

export function drawBust(ctx, w, h, v = {}) {
  const { cx = 0.5, scale = 1, glasses = false, beard = false, hair = 'short', light = -1 } = v;
  ctx.save();
  ctx.translate(w * cx, 0);
  ctx.scale(scale, scale);
  ctx.translate(-w * 0.5, h * (1 - scale) / scale);
  const lx = w * (0.5 + light * 0.07);

  // shoulders / torso
  const g1 = ctx.createRadialGradient(lx, h * 0.72, w * 0.02, w * 0.5, h * 0.85, w * 0.55);
  g1.addColorStop(0, '#b8b8b8'); g1.addColorStop(0.5, '#555'); g1.addColorStop(1, '#0a0a0a');
  ctx.fillStyle = g1;
  ctx.beginPath();
  ctx.moveTo(w * 0.02, h);
  ctx.bezierCurveTo(w * 0.04, h * 0.8, w * 0.18, h * 0.72, w * 0.38, h * 0.68);
  ctx.lineTo(w * 0.62, h * 0.68);
  ctx.bezierCurveTo(w * 0.82, h * 0.72, w * 0.96, h * 0.8, w * 0.98, h);
  ctx.closePath(); ctx.fill();

  // collar shadow
  ctx.fillStyle = 'rgba(0,0,0,.55)';
  ctx.beginPath(); ctx.moveTo(w * 0.4, h * 0.68); ctx.lineTo(w * 0.5, h * 0.8); ctx.lineTo(w * 0.6, h * 0.68); ctx.fill();

  // neck
  const g2 = ctx.createLinearGradient(w * 0.42, 0, w * 0.58, 0);
  g2.addColorStop(0, light < 0 ? '#999' : '#333'); g2.addColorStop(1, light < 0 ? '#333' : '#999');
  ctx.fillStyle = g2; ctx.fillRect(w * 0.42, h * 0.5, w * 0.16, h * 0.2);

  // head
  const g3 = ctx.createRadialGradient(lx, h * 0.3, w * 0.02, w * 0.5, h * 0.38, w * 0.22);
  g3.addColorStop(0, '#f2f2f2'); g3.addColorStop(0.55, '#9a9a9a'); g3.addColorStop(1, '#202020');
  ctx.fillStyle = g3;
  ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.36, w * 0.155, h * 0.185, 0, 0, Math.PI * 2); ctx.fill();
  // ears
  ctx.beginPath(); ctx.ellipse(w * 0.345, h * 0.38, w * 0.022, h * 0.04, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w * 0.655, h * 0.38, w * 0.022, h * 0.04, 0, 0, Math.PI * 2); ctx.fill();

  // hair
  ctx.fillStyle = '#1c1c1c';
  ctx.beginPath();
  if (hair === 'swept') {
    ctx.ellipse(w * 0.5, h * 0.24, w * 0.165, h * 0.1, -0.12, Math.PI, Math.PI * 2.05);
  } else {
    ctx.ellipse(w * 0.5, h * 0.25, w * 0.16, h * 0.085, 0, Math.PI * 0.95, Math.PI * 2.05);
  }
  ctx.fill();
  for (let i = 0; i < 260; i++) { // hair texture
    const a = Math.PI + Math.random() * Math.PI, r = Math.random();
    ctx.fillStyle = `rgba(255,255,255,${Math.random() * 0.35})`;
    ctx.fillRect(w * 0.5 + Math.cos(a) * w * 0.15 * r, h * 0.25 + Math.sin(a) * h * 0.08 * r, 1, 1);
  }

  // eyes / brows
  ctx.fillStyle = 'rgba(0,0,0,.7)';
  ctx.fillRect(w * 0.42, h * 0.34, w * 0.05, h * 0.008);
  ctx.fillRect(w * 0.53, h * 0.34, w * 0.05, h * 0.008);
  ctx.beginPath(); ctx.ellipse(w * 0.445, h * 0.365, w * 0.014, h * 0.008, 0, 0, Math.PI * 2); ctx.fill();
  ctx.beginPath(); ctx.ellipse(w * 0.555, h * 0.365, w * 0.014, h * 0.008, 0, 0, Math.PI * 2); ctx.fill();
  if (glasses) {
    ctx.strokeStyle = 'rgba(255,255,255,.55)'; ctx.lineWidth = Math.max(1, w * 0.005);
    ctx.strokeRect(w * 0.405, h * 0.345, w * 0.08, h * 0.045);
    ctx.strokeRect(w * 0.515, h * 0.345, w * 0.08, h * 0.045);
    ctx.beginPath(); ctx.moveTo(w * 0.485, h * 0.36); ctx.lineTo(w * 0.515, h * 0.36); ctx.stroke();
  }
  // nose + mouth
  ctx.fillStyle = 'rgba(0,0,0,.35)';
  ctx.fillRect(w * (light < 0 ? 0.505 : 0.49), h * 0.37, w * 0.008, h * 0.06);
  ctx.fillStyle = 'rgba(0,0,0,.6)';
  ctx.fillRect(w * 0.465, h * 0.455, w * 0.07, h * 0.007);
  if (beard) {
    const gb = ctx.createLinearGradient(0, h * 0.4, 0, h * 0.56);
    gb.addColorStop(0, 'rgba(20,20,20,0)'); gb.addColorStop(1, 'rgba(20,20,20,.85)');
    ctx.fillStyle = gb;
    ctx.beginPath(); ctx.ellipse(w * 0.5, h * 0.46, w * 0.15, h * 0.09, 0, 0, Math.PI); ctx.fill();
  }
  // film grain for texture
  const img = ctx.getImageData(0, 0, w, h), d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    if (!d[i + 3]) continue;
    const n = (Math.random() - 0.5) * 50;
    d[i] += n; d[i + 1] += n; d[i + 2] += n;
  }
  ctx.putImageData(img, 0, 0);
  ctx.restore();
}

/* ---------- renderer ---------- */

const PALETTES = {
  blue: ['#06275e', '#2a86ff', '#d6ecff'],
};

export class ParticleField {
  constructor(container, opts = {}) {
    this.el = container;
    this.o = Object.assign({
      fov: 35, camZ: 4.2, stars: 0, palette: 'blue', mouse: true,
      introDuration: 2.8, autoIntro: true, glitch: 1, drift: 1,
      tilt: 0.22, spin: 0, layout: null, opacity: 1, sizeMul: 1.6,
    }, opts);
    this.time = 0; this.intro = 0; this.playing = true; this.visible = true;
    this.mouseNdc = new THREE.Vector2(9, 9); this.mouseTarget = 0; this.mouseOn = 0;
    this.tiltTarget = new THREE.Vector2();
    this.morphTween = null;

    this.renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    container.appendChild(this.renderer.domElement);
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(this.o.fov, 1, 0.1, 50);
    this.camera.position.z = this.o.camZ;
    this.group = new THREE.Group();
    this.scene.add(this.group);
    this.inner = new THREE.Group();
    this.group.add(this.inner);

    const pal = PALETTES[this.o.palette];
    this.uniforms = {
      uTime: { value: 0 }, uIntro: { value: 0 }, uSize: { value: 0.01 }, uScale: { value: 500 },
      uMorph: { value: 0 }, uGlitch: { value: this.o.glitch }, uDrift: { value: this.o.drift },
      uMouse: { value: new THREE.Vector2(99, 99) }, uMouseR: { value: 0.32 }, uMouseOn: { value: 0 },
      uColorA: { value: new THREE.Color(pal[0]) }, uColorB: { value: new THREE.Color(pal[1]) },
      uColorC: { value: new THREE.Color(pal[2]) }, uOpacity: { value: this.o.opacity },
    };
    this.material = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, uniforms: this.uniforms,
      transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    });

    if (this.o.stars) this._addStars(this.o.stars);

    this.raycaster = new THREE.Raycaster();
    this.plane = new THREE.Plane(new THREE.Vector3(0, 0, 1), 0);
    this._hit = new THREE.Vector3();

    this._onResize = () => this.resize();
    window.addEventListener('resize', this._onResize);
    if (this.o.mouse) {
      const target = this.o.mouseTargetEl || container;
      target.addEventListener('pointermove', (e) => {
        const r = this.renderer.domElement.getBoundingClientRect();
        this.mouseNdc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
        this.tiltTarget.set(this.mouseNdc.x, this.mouseNdc.y);
        this.mouseTarget = 1;
      });
      target.addEventListener('pointerleave', () => { this.mouseTarget = 0; this.tiltTarget.set(0, 0); });
    }
    new IntersectionObserver(([e]) => {
      this.visible = e.isIntersecting;
      if (this.visible && !this.o.autoIntro && !this._introStarted) this.startIntro();
    }, { threshold: 0.05 }).observe(container);

    this.clock = new THREE.Clock();
    this.resize();
    this._loop = this._loop.bind(this);
    requestAnimationFrame(this._loop);
  }

  _addStars(n) {
    const g = new THREE.BufferGeometry();
    const p = new Float32Array(n * 3), s = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      p.set([(Math.random() - 0.5) * 14, (Math.random() - 0.5) * 8, -Math.random() * 6], i * 3);
      s[i] = Math.random();
    }
    g.setAttribute('position', new THREE.BufferAttribute(p, 3));
    g.setAttribute('aSeed', new THREE.BufferAttribute(s, 1));
    this.starUniforms = { uTime: { value: 0 }, uScale: this.uniforms.uScale };
    const m = new THREE.ShaderMaterial({
      uniforms: this.starUniforms, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
      vertexShader: `uniform float uTime; uniform float uScale; attribute float aSeed; varying float vA;
        void main(){ vec4 mv = modelViewMatrix * vec4(position,1.0); gl_Position = projectionMatrix*mv;
        vA = 0.25 + 0.75 * (0.5 + 0.5 * sin(uTime * (0.6 + aSeed * 2.0) + aSeed * 40.0));
        gl_PointSize = (0.006 + aSeed * 0.01) * uScale / -mv.z; }`,
      fragmentShader: `varying float vA; void main(){ float r = length(gl_PointCoord-0.5); if(r>0.5) discard;
        gl_FragColor = vec4(0.25,0.55,1.0, vA * smoothstep(0.5,0.0,r) * 0.8); }`,
    });
    this.stars = new THREE.Points(g, m);
    this.scene.add(this.stars);
  }

  setData(data, alt) {
    if (this.points) { this.inner.remove(this.points); this.points.geometry.dispose(); }
    const n = data.count;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(data.positions, 3));
    g.setAttribute('aLum', new THREE.BufferAttribute(data.lum, 1));
    const rnd = new Float32Array(n * 4);
    for (let i = 0; i < rnd.length; i++) rnd[i] = Math.random();
    g.setAttribute('aRnd', new THREE.BufferAttribute(rnd, 4));
    g.setAttribute('aAlt', new THREE.BufferAttribute(alt || data.positions.slice(), 3));
    this.points = new THREE.Points(g, this.material);
    this.points.frustumCulled = false;
    this.inner.add(this.points);
    this.data = data;
    this.uniforms.uSize.value = data.cellSize * this.o.sizeMul;
    this.resize();
    if (this.o.autoIntro) this.startIntro();
  }

  startIntro() {
    this._introStarted = true;
    this.intro = 0;
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) this.intro = 1;
  }

  // Animate from current shape to `target` positions (same count).
  morphTo(target, duration = 1.6) {
    const g = this.points.geometry;
    const pos = g.attributes.position, alt = g.attributes.aAlt;
    if (this.uniforms.uMorph.value > 0) { // bake the in-between state
      pos.array.set(alt.array.slice()); pos.needsUpdate = true;
    }
    alt.array.set(target); alt.needsUpdate = true;
    this.uniforms.uMorph.value = 0;
    this.morphTween = { t: 0, d: duration };
  }

  setMorph(v) { this.uniforms.uMorph.value = v; }

  resize() {
    const w = this.el.clientWidth || 1, h = this.el.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.renderer.domElement.style.width = '100%';
    this.renderer.domElement.style.height = '100%';
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    const buf = h * this.renderer.getPixelRatio();
    this.uniforms.uScale.value = buf / (2 * Math.tan(THREE.MathUtils.degToRad(this.o.fov) / 2));
    const vh = 2 * this.o.camZ * Math.tan(THREE.MathUtils.degToRad(this.o.fov) / 2);
    this.view = { w: vh * this.camera.aspect, h: vh, px: w, py: h };
    if (this.o.layout && this.data) {
      const L = this.o.layout(this.view, this.data);
      this.group.position.set(L.x || 0, L.y || 0, 0);
      this.group.scale.setScalar(L.scale || 1);
    }
  }

  pause(v = true) { this.playing = !v; }

  _loop() {
    requestAnimationFrame(this._loop);
    const raw = this.clock.getDelta();
    const dt = Math.min(raw, 0.05);
    if (!this.visible || !this.points) return;
    if (this.playing) this.time += dt;
    const u = this.uniforms;
    u.uTime.value = this.time;
    if (this.starUniforms) this.starUniforms.uTime.value = this.time;

    if (this._introStarted && this.intro < 1) {
      // wall-clock based so the intro finishes on time even on slow devices
      this.intro = Math.min(1, this.intro + Math.min(raw, 0.5) / this.o.introDuration);
    }
    u.uIntro.value = this.intro;

    if (this.morphTween) {
      const m = this.morphTween;
      m.t = Math.min(1, m.t + dt / m.d);
      u.uMorph.value = m.t < 0.5 ? 4 * m.t ** 3 : 1 - (-2 * m.t + 2) ** 3 / 2;
      if (m.t >= 1) this.morphTween = null;
    }

    // mouse in local coordinates
    this.mouseOn += (this.mouseTarget - this.mouseOn) * 0.08;
    u.uMouseOn.value = this.mouseOn;
    if (this.mouseTarget) {
      this.raycaster.setFromCamera(this.mouseNdc, this.camera);
      if (this.raycaster.ray.intersectPlane(this.plane, this._hit)) {
        this.inner.worldToLocal(this._hit);
        u.uMouse.value.lerp(new THREE.Vector2(this._hit.x, this._hit.y), 0.25);
      }
    }

    // 3D parallax tilt + optional spin
    const tilt = this.o.tilt;
    this.inner.rotation.y += (this.tiltTarget.x * tilt - this.inner.rotation.y) * 0.05;
    this.inner.rotation.x += (-this.tiltTarget.y * tilt * 0.6 - this.inner.rotation.x) * 0.05;
    if (this.o.spin) this.group.rotation.y += dt * this.o.spin * (this.playing ? 1 : 0);
    if (this.stars) {
      this.stars.rotation.y = this.inner.rotation.y * 0.3;
      this.stars.rotation.x = this.inner.rotation.x * 0.3;
    }

    this.renderer.render(this.scene, this.camera);
  }
}
