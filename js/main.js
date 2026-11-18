import {
  ParticleField, sampleDrawing, loadImage, drawContain, drawBust,
  sphereShape, helixShape, waveShape, textShape, scatterShape,
} from './particles.js?v=12';

/* ================= CONFIG — edit these ================= */
const CONTACT_EMAIL = 'hello@example.com'; // TODO: replace with rAlix AI's real address
const IMAGES = {
  // Drop photos into /assets with any of these names. Transparent PNG cut-outs on a
  // dark background give the cleanest particle portraits.
  hero: ['assets/hero.png', 'assets/hero.webp', 'assets/hero.jpg'],
  rahil: ['assets/rahil.png', 'assets/rahil.webp', 'assets/rahil.jpg'],
  ali: ['assets/ali.png', 'assets/ali.webp', 'assets/ali.jpg'],
};
// Original photos + a cut-out mask (made with person segmentation). crop = [x, y, w, h] in the photo.
const PEOPLE = {
  // tone = canvas filter applied before sampling (softens bright jackets so faces read)
  ali: { src: 'assets/ali-source.jpg', mask: 'assets/ali-mask.png', crop: [50, 150, 780, 1080], tone: 'contrast(0.85) brightness(1.1)' },
  // both founders together — used for the hero
  duo: { src: 'assets/founders-source.jpg', mask: 'assets/founders-mask.png', crop: [15, 95, 1070, 905], tone: 'contrast(0.8) brightness(1.1)' },
  rahil: { src: 'assets/rahil-source.webp', mask: 'assets/rahil-mask.png', crop: [230, 20, 700, 876], tone: 'contrast(0.72) brightness(1.18)' },
};
/* ======================================================= */

const gsap = window.gsap;
const ST = window.ScrollTrigger;
if (gsap && ST) gsap.registerPlugin(ST);
const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];

if (gsap) document.documentElement.classList.add('js');
document.body.classList.add('loading');

async function loadFirst(list) {
  for (const src of list) {
    const img = await loadImage(src);
    if (img) return img;
  }
  return null;
}

async function loadPerson(p) {
  if (!p) return null;
  const [img, mask] = await Promise.all([loadImage(p.src), loadImage(p.mask)]);
  return img && mask ? { img, mask, crop: p.crop, tone: p.tone } : null;
}

// Draw the cropped photo, keep only the masked person, bottom-aligned "contain" fit.
// Optional `at` = { x: centre as fraction of width, h: height as fraction of canvas height }.
function drawPerson(ctx, w, h, { img, mask, crop, tone }, at) {
  const [cx, cy, cw, ch] = crop;
  const s = at ? (h * at.h) / ch : Math.min(w / cw, h / ch);
  const dw = cw * s, dh = ch * s;
  const dx = at ? w * at.x - dw / 2 : (w - dw) / 2, dy = h - dh;
  const t = document.createElement('canvas'); t.width = w; t.height = h;
  const tx = t.getContext('2d', { willReadFrequently: true }); tx.imageSmoothingQuality = 'high';
  if (tone) tx.filter = tone;
  tx.drawImage(img, cx, cy, cw, ch, dx, dy, dw, dh);
  tx.filter = 'none';
  tx.globalCompositeOperation = 'destination-in';
  tx.drawImage(mask, dx, dy, dw, dh);
  enhance(tx, w, h);
  // fade the bottom of the crop so the figure dissolves instead of ending in a hard line
  const fade = tx.createLinearGradient(0, dy + dh * 0.8, 0, dy + dh);
  fade.addColorStop(0, 'rgba(0,0,0,1)'); fade.addColorStop(1, 'rgba(0,0,0,0)');
  tx.globalCompositeOperation = 'destination-in';
  tx.fillStyle = fade; tx.fillRect(0, 0, w, h); // gradient pads: opaque above the fade, clear below
  ctx.drawImage(t, 0, 0);
}

// Alpha-weighted box blur (separable running sums) — mean brightness around each pixel.
function boxMean(V, A, w, h, r) {
  const tmpV = new Float32Array(w * h), tmpA = new Float32Array(w * h);
  const outV = new Float32Array(w * h), outA = new Float32Array(w * h);
  for (let y = 0; y < h; y++) {
    let sv = 0, sa = 0;
    for (let x = -r; x <= r; x++) { const q = y * w + Math.min(w - 1, Math.max(0, x)); sv += V[q] * A[q]; sa += A[q]; }
    for (let x = 0; x < w; x++) {
      tmpV[y * w + x] = sv; tmpA[y * w + x] = sa;
      const qa = y * w + Math.min(w - 1, x + r + 1), qr = y * w + Math.max(0, x - r);
      sv += V[qa] * A[qa] - V[qr] * A[qr]; sa += A[qa] - A[qr];
    }
  }
  for (let x = 0; x < w; x++) {
    let sv = 0, sa = 0;
    for (let y = -r; y <= r; y++) { const q = Math.min(h - 1, Math.max(0, y)) * w + x; sv += tmpV[q]; sa += tmpA[q]; }
    for (let y = 0; y < h; y++) {
      outV[y * w + x] = sv; outA[y * w + x] = sa;
      const qa = Math.min(h - 1, y + r + 1) * w + x, qr = Math.max(0, y - r) * w + x;
      sv += tmpV[qa] - tmpV[qr]; sa += tmpA[qa] - tmpA[qr];
    }
  }
  for (let p = 0; p < outV.length; p++) outV[p] = outA[p] > 0.001 ? outV[p] / outA[p] : 0;
  return outV;
}

// Per-person levels (5th–98th percentile → full range, slight gamma lift) plus an
// unsharp-style sharpen, so eyes, beard and hairline survive the jump to dots.
function enhance(c, w, h) {
  const im = c.getImageData(0, 0, w, h), d = im.data;
  const L = new Float32Array(w * h), vals = [];
  for (let i = 0, p = 0; i < d.length; i += 4, p++) {
    L[p] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) / 255;
    if (d[i + 3] > 128) vals.push(L[p]);
  }
  if (vals.length < 100) return;
  vals.sort((a, b) => a - b);
  const lo = vals[Math.floor(vals.length * 0.05)], hi = vals[Math.floor(vals.length * 0.98)];
  const span = Math.max(0.05, hi - lo);
  const N = new Float32Array(w * h), A = new Float32Array(w * h);
  for (let p = 0; p < N.length; p++) {
    N[p] = Math.pow(Math.min(1, Math.max(0, (L[p] - lo) / span)), 0.8);
    A[p] = d[p * 4 + 3] / 255;
  }
  // Local tone mapping: divide by the neighbourhood's mean brightness (inside the
  // subject only) so dark faces lift and bright jackets calm down, keeping detail.
  const r = Math.max(4, Math.round(Math.min(w, h) / 22));
  const mean = boxMean(N, A, w, h, r);
  for (let p = 0; p < N.length; p++) {
    if (A[p] < 0.02) continue;
    const local = (0.62 * N[p]) / (mean[p] + 0.1);
    N[p] = Math.pow(Math.min(1, N[p] * 0.35 + local * 0.65), 0.85);
  }
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      const p = y * w + x;
      let v = N[p];
      if (x > 0 && y > 0 && x < w - 1 && y < h - 1) {
        const blur = (N[p - 1] + N[p + 1] + N[p - w] + N[p + w]) / 4;
        v = v + (v - blur) * 0.9; // sharpen
      }
      v = Math.min(1, Math.max(0, v)) * 255;
      d[p * 4] = d[p * 4 + 1] = d[p * 4 + 2] = v;
    }
  }
  c.putImageData(im, 0, 0);
}

/* ---------------- loader ---------------- */
const loader = $('.loader');
let shown = 0;
function setProgress(p) {
  const target = Math.round(p * 100);
  const step = () => {
    if (shown < target) {
      shown += Math.max(1, Math.round((target - shown) / 6));
      shown = Math.min(shown, target);
      $('.loader__count').textContent = String(shown).padStart(3, '0');
      $('.loader__bar span').style.width = shown + '%';
      requestAnimationFrame(step);
    }
  };
  step();
}
setProgress(0.15);

/* ---------------- hero particles ---------------- */
const heroField = new ParticleField($('#hero-canvas'), {
  stars: 900, introDuration: 3.2, tilt: 0.28, sizeMul: 1.15, opacity: 0.95,
  mouseTargetEl: $('#hero'),
  layout(view, data) {
    if (view.px < 860) {
      const scale = (view.h * 0.56) / 2;
      return { x: 0, y: view.h * 0.1, scale };
    }
    const scale = Math.min((view.h * 0.86) / 2, (view.w * 0.465) / data.width);
    return { x: -view.w / 2 + (data.width * scale) / 2 + view.w * 0.04, y: -view.h * 0.035, scale };
  },
});

const heroImg = await loadFirst(IMAGES.hero);
const heroDuo = heroImg ? null : await loadPerson(PEOPLE.duo);
const [heroAli, heroRahil] = heroImg || heroDuo ? [null, null] : await Promise.all([loadPerson(PEOPLE.ali), loadPerson(PEOPLE.rahil)]);
const heroPeople = !!(heroDuo || heroAli || heroRahil);
setProgress(0.55);
const heroData = sampleDrawing((ctx, w, h) => {
  if (heroImg) return drawContain(ctx, heroImg, w, h);
  if (heroDuo) return drawPerson(ctx, w, h, heroDuo);
  if (heroAli && heroRahil) {
    // both founders: Ali behind on the right (looking toward the copy), Rahil in front on the left
    drawPerson(ctx, w, h, heroAli, { x: 0.72, h: 1 });
    drawPerson(ctx, w, h, heroRahil, { x: 0.29, h: 0.9 });
    return;
  }
  if (heroAli || heroRahil) return drawPerson(ctx, w, h, heroAli || heroRahil);
  // placeholder until real photos are supplied: both founders side by side
  drawBust(ctx, w, h, { cx: 0.32, scale: 0.86, glasses: true, beard: true, light: -1 });
  drawBust(ctx, w, h, { cx: 0.7, scale: 0.94, hair: 'swept', light: 1 });
}, heroPeople
  ? { cols: 520, aspect: heroDuo ? 905 / 1070 : heroAli && heroRahil ? 0.8 : 1.36, depth: 0.45, floor: 0.1, contrast: 1.12, sparse: false, jitter: 0.3 }
  : { cols: 300, aspect: 0.92, depth: 0.45, mask: !!heroImg });
heroField.setData(heroData, scatterShape(heroData.positions));
setProgress(0.85);

// scroll: the portrait disperses into the starfield as you leave the hero
if (ST) {
  ST.create({
    trigger: '#hero', start: 'top top', end: 'bottom top', scrub: true,
    onUpdate: (s) => {
      heroField.setMorph(s.progress);
      $('#hero-canvas').style.opacity = String(1 - s.progress * 0.6);
    },
  });
}

// pause button
const pauseBtn = $('.hero__pause');
pauseBtn.addEventListener('click', () => {
  const paused = pauseBtn.getAttribute('aria-pressed') !== 'true';
  pauseBtn.setAttribute('aria-pressed', String(paused));
  pauseBtn.setAttribute('aria-label', paused ? 'Play animation' : 'Pause animation');
  heroField.pause(paused);
});
if (reduced) pauseBtn.click();

/* ---------------- loader out + hero intro text ---------------- */
setProgress(1);
await new Promise((r) => setTimeout(r, 450));
loader.classList.add('is-done');
document.body.classList.remove('loading');

scramble($('[data-scramble]'));
if (gsap && !reduced) {
  gsap.from('.hero__copy > *', { y: 30, opacity: 0, duration: 1.1, stagger: 0.12, delay: 0.6, ease: 'power3.out' });
  gsap.from('.nav > *', { y: -20, opacity: 0, duration: 0.9, stagger: 0.08, ease: 'power3.out' });
  gsap.from('.hero__foot > *', { opacity: 0, duration: 1, delay: 1.2, stagger: 0.1 });
}

/* ---------------- rotating word ---------------- */
(function rotator() {
  const el = $('.rotator span');
  const words = ['that think.', 'that scale.', 'that ship.', 'that sell.'];
  let i = 0;
  setInterval(() => {
    if (document.hidden) return;
    i = (i + 1) % words.length;
    if (!gsap || reduced) { el.textContent = words[i]; return; }
    gsap.to(el, {
      yPercent: -110, opacity: 0, duration: 0.35, ease: 'power2.in', onComplete() {
        el.textContent = words[i];
        gsap.fromTo(el, { yPercent: 110, opacity: 0 }, { yPercent: 0, opacity: 1, duration: 0.45, ease: 'power3.out' });
      },
    });
  }, 2600);
})();

/* ---------------- text scramble ---------------- */
function scramble(el) {
  if (!el || reduced) return;
  const html = el.innerHTML;
  const final = el.textContent;
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789/_#';
  let frame = 0;
  const total = 50;
  const tick = () => {
    frame++;
    const reveal = Math.floor((frame / total) * final.length);
    let out = '';
    for (let k = 0; k < final.length; k++) {
      out += k < reveal || final[k] === ' ' ? final[k] : chars[Math.floor(Math.random() * chars.length)];
    }
    el.textContent = out;
    if (frame < total) requestAnimationFrame(tick); else el.innerHTML = html;
  };
  tick();
}

/* ---------------- split headlines + reveals ---------------- */
$$('.split').forEach((el) => {
  const walk = (node) => {
    [...node.childNodes].forEach((n) => {
      if (n.nodeType === 3) {
        const frag = document.createDocumentFragment();
        n.textContent.split(/(\s+)/).forEach((part) => {
          if (!part) return;
          if (/^\s+$/.test(part)) return frag.appendChild(document.createTextNode(part));
          const w = document.createElement('span'); w.className = 'w';
          const inner = document.createElement('span'); inner.textContent = part;
          w.appendChild(inner); frag.appendChild(w);
        });
        n.replaceWith(frag);
      } else if (n.nodeType === 1 && n.tagName !== 'BR') walk(n);
    });
  };
  walk(el);
});

if (gsap && ST && !reduced) {
  $$('.split').forEach((el) => {
    gsap.from($$('.w > span', el), {
      yPercent: 110, rotate: 4, duration: 1.1, ease: 'power4.out', stagger: 0.06,
      scrollTrigger: { trigger: el, start: 'top 88%' },
    });
  });
  ST.batch('.reveal', {
    start: 'top 90%',
    onEnter: (els) => gsap.to(els, { opacity: 1, y: 0, duration: 1, ease: 'power3.out', stagger: 0.1 }),
  });
  gsap.to('.process__meter span', {
    width: '100%', ease: 'none',
    scrollTrigger: { trigger: '.steps', start: 'top 60%', end: 'bottom 60%', scrub: true },
  });
  gsap.to('.footer__big', {
    yPercent: -12, ease: 'none', scrollTrigger: { trigger: '.footer', start: 'top bottom', end: 'bottom bottom', scrub: true },
  });
} else {
  $$('.reveal').forEach((el) => { el.style.opacity = 1; el.style.transform = 'none'; });
  const m = $('.process__meter span'); if (m) m.style.width = '100%';
}

/* ---------------- lab: morphing particle cloud ---------------- */
await document.fonts.ready;
const LAB_N = 16000;
const labShapes = {
  sphere: sphereShape(LAB_N),
  text: textShape(LAB_N, 'rAlix', { font: '800 190px Inter Tight, sans-serif', width: 2.4 }),
  helix: helixShape(LAB_N),
  wave: waveShape(LAB_N),
};
const labField = new ParticleField($('#lab-canvas'), {
  stars: 400, autoIntro: false, introDuration: 2.4, tilt: 0.5, drift: 0.25, glitch: 0.4, sizeMul: 1,
  layout(view) {
    const wide = view.px >= 860;
    return { x: wide ? view.w * 0.17 : 0, y: wide ? 0 : -view.h * 0.14, scale: Math.min(view.h * 0.32, view.w * 0.32) };
  },
});
const labLum = new Float32Array(LAB_N);
for (let i = 0; i < LAB_N; i++) labLum[i] = 0.35 + Math.random() * 0.65;
labField.setData({ positions: labShapes.sphere.slice(), lum: labLum, count: LAB_N, cellSize: 0.016, width: 2, height: 2 });
labField.o.spin = 0.18;
$$('.lab__btns .chip').forEach((b) => b.addEventListener('click', () => {
  $$('.lab__btns .chip').forEach((x) => x.classList.toggle('is-active', x === b));
  const shape = b.dataset.shape;
  labField.morphTo(labShapes[shape], 1.8);
  labField.o.spin = shape === 'text' ? 0 : 0.18;
  if (shape === 'text' && gsap) gsap.to(labField.group.rotation, { y: 0, duration: 1.4, ease: 'power3.out' });
}));

/* ---------------- founders: particle portraits ---------------- */
async function founder(el, sources, person, bust) {
  const field = new ParticleField(el, {
    autoIntro: false, introDuration: 2.6, tilt: 0.3, sizeMul: 1.15, opacity: 0.95, camZ: 4,
    layout(view, data) {
      const scale = (view.h * 0.9) / 2;
      return { x: 0, y: -view.h * 0.04, scale: Math.min(scale, (view.w * 0.92) / data.width) };
    },
  });
  const img = await loadFirst(sources);
  const pers = img ? null : await loadPerson(person);
  const data = sampleDrawing((ctx, w, h) => {
    if (img) return drawContain(ctx, img, w, h);
    if (pers) return drawPerson(ctx, w, h, pers);
    return drawBust(ctx, w, h, bust);
  }, pers ? { cols: 340, aspect: 1, depth: 0.45, floor: 0.1, contrast: 1.12, sparse: false, jitter: 0.3 } : { cols: 220, aspect: 1, depth: 0.45, mask: !!img });
  field.setData(data);
  return field;
}
founder($('#founder-rahil'), IMAGES.rahil, PEOPLE.rahil, { scale: 0.95, hair: 'swept', light: -1 });
founder($('#founder-ali'), IMAGES.ali, PEOPLE.ali, { scale: 0.95, glasses: true, beard: true, light: 1 });

/* ---------------- card tilt + glow ---------------- */
$$('.tilt').forEach((card) => {
  card.addEventListener('pointermove', (e) => {
    const r = card.getBoundingClientRect();
    const x = (e.clientX - r.left) / r.width, y = (e.clientY - r.top) / r.height;
    card.style.setProperty('--mx', x * 100 + '%');
    card.style.setProperty('--my', y * 100 + '%');
    if (!reduced) card.style.transform = `rotateY(${(x - 0.5) * 12}deg) rotateX(${(0.5 - y) * 10}deg)`;
  });
  card.addEventListener('pointerleave', () => { card.style.transform = ''; });
});

/* ---------------- magnetic buttons + cursor ---------------- */
const fine = matchMedia('(hover: hover) and (pointer: fine)').matches;
if (fine && !reduced) {
  $$('.magnetic').forEach((b) => {
    b.addEventListener('pointermove', (e) => {
      const r = b.getBoundingClientRect();
      b.style.transform = `translate(${(e.clientX - r.left - r.width / 2) * 0.25}px, ${(e.clientY - r.top - r.height / 2) * 0.35}px)`;
    });
    b.addEventListener('pointerleave', () => { b.style.transform = ''; });
  });
  const cur = $('.cursor'), dot = $('.cursor__dot'), ring = $('.cursor__ring');
  let mx = -100, my = -100, rx = -100, ry = -100;
  addEventListener('pointermove', (e) => { mx = e.clientX; my = e.clientY; });
  (function follow() {
    rx += (mx - rx) * 0.18; ry += (my - ry) * 0.18;
    dot.style.transform = `translate(${mx}px, ${my}px) translate(-50%,-50%)`;
    ring.style.transform = `translate(${rx}px, ${ry}px) translate(-50%,-50%)`;
    requestAnimationFrame(follow);
  })();
  document.addEventListener('pointerover', (e) => cur.classList.toggle('is-hover', !!e.target.closest('a,button,input,textarea')));
}

/* ---------------- nav behaviour ---------------- */
const nav = $('.nav');
let lastY = 0;
addEventListener('scroll', () => {
  const y = scrollY;
  nav.classList.toggle('is-scrolled', y > 40);
  nav.classList.toggle('is-hidden', y > lastY && y > innerHeight * 0.8 && $('.mobile-menu').hidden);
  lastY = y;
}, { passive: true });
const burger = $('.nav__burger'), menu = $('.mobile-menu');
burger.addEventListener('click', () => {
  const open = menu.hidden;
  menu.hidden = !open;
  burger.setAttribute('aria-expanded', String(open));
  document.body.style.overflow = open ? 'hidden' : '';
});
$$('a', menu).forEach((a) => a.addEventListener('click', () => burger.click()));

/* ---------------- clock + year ---------------- */
const clock = $('[data-clock]');
const tickClock = () => { clock.textContent = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }); };
tickClock(); setInterval(tickClock, 15000);
$('[data-year]').textContent = new Date().getFullYear();

/* ---------------- brief prompt → contact form ---------------- */
const promptInput = $('#prompt-input');
$$('#prompt-form .chip').forEach((c) => c.addEventListener('click', () => { promptInput.value = c.textContent; promptInput.focus(); }));
$('#prompt-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const msg = $('#contact-form textarea');
  if (promptInput.value.trim()) msg.value = promptInput.value.trim();
  $('#contact').scrollIntoView({ behavior: reduced ? 'auto' : 'smooth' });
  setTimeout(() => $('#contact-form input[name=name]').focus({ preventScroll: true }), 900);
});
$('#contact-form').addEventListener('submit', (e) => {
  e.preventDefault();
  const f = new FormData(e.target);
  const body = `${f.get('message')}\n\n— ${f.get('name')} (${f.get('email')})`;
  location.href = `mailto:${CONTACT_EMAIL}?subject=${encodeURIComponent('New brief from ' + f.get('name'))}&body=${encodeURIComponent(body)}`;
  $('.form__status').textContent = 'Opening your email app…';
});
