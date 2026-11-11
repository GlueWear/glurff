/* THE WAY IN (2026-11-04): the loading screen -- travelling through space to a
 * Glurff, and landing in it.
 *
 * A plain script beside the bundle rather than in it: it is the first thing in
 * the page, so space is there from the first paint and keeps moving while the
 * bundle, the map and the world arrive behind it. ui/loading says what is
 * happening, through window.glurffLoading:
 *
 *   to(name, host)      where we are going: its name, drawn in pixels, and the
 *                       ship that hosts it.
 *   progress(f, words)  how far along, 0..1, and what is happening now.
 *   notice(n)           something in the way, said on it: {title, detail,
 *                       action: {label, run}, stop}. `stop` holds us still in
 *                       space -- access removed, a request turned down --
 *                       rather than travelling on; with no title, it only
 *                       holds us. notice(null) clears it.
 *   land(where)         arrive: faster, the planet rushes up, and it opens
 *                       onto the world around where(), {x, y} on the page --
 *                       our character. Resolves once the world is in view. A
 *                       tap or a key gets there at once.
 *   show()              out into space again, over the world, the bar
 *                       empty: access lost, or another map of the world
 *                       whose pictures are not in yet (ui/loading).
 *
 * All of it is drawn here -- the stars, the planet, its ring, the name -- a
 * few screen pixels to each of its own, so it is pixel art at any size and
 * borrows nothing from the map: any Glurff can be arrived at this way.
 *
 * A playtest's page asks for none of the journey (`data-plain` on #loading).
 *
 * An automated browser is not kept waiting (navigator.webdriver, as the checks
 * run): the screen steps aside at once, unless the page was told to keep it
 * (window.__keepLoading) by a check of the screen itself.
 */
(() => {
  const root = document.getElementById('loading');
  if (!root) return;
  const $ = (s) => root.querySelector(s);
  const sky = $('.loading-sky'), card = $('.loading-card'), g = sky.getContext('2d');
  const automated = !!navigator.webdriver && !window.__keepLoading;
  /* A PLAYTEST'S SCREEN (2026-11-09; `data-plain`): no journey through space
   * -- a playtest goes nowhere -- only its name, the bar and the words, and a
   * quick fade once it is ready. */
  const plain = root.hasAttribute('data-plain');
  const still = plain || !!globalThis.matchMedia?.('(prefers-reduced-motion: reduce)').matches;

  /* Colours, packed as the canvas keeps them (little-endian RGBA). */
  const px = (hex) => { const n = parseInt(hex.slice(1), 16); return ((255 << 24) | ((n & 255) << 16) | (n & 0xff00) | (n >> 16)) >>> 0; };
  const mix = (a, b, t) => '#' + [0, 2, 4].map((i) => Math.round(parseInt(a.substr(1 + i, 2), 16) * (1 - t)
    + parseInt(b.substr(1 + i, 2), 16) * t).toString(16).padStart(2, '0')).join('');
  const SPACE_TOP = '#04060d', SPACE_BOTTOM = '#0d1328';
  /* The planet of the Glurff icon: deep blue seas, paler lands, a pale ring. */
  const SEA = ['#0a1236', '#13216a', '#1c3595', '#2a52c0', '#3f74e0'].map(px);
  const LAND = ['#163e86', '#2463c4', '#3d86e8', '#67aaf5', '#9cccff'].map(px);
  const GLOW = px('#16244f'), RING_BACK = px('#43689f'), RING = [px('#86b7f2'), px('#c8e4ff')], RIM = px('#d8ecff');
  /* Each star in three strengths, far to near. */
  const STARS = ['#ffffff', '#cfe3ff', '#ffe9c2', '#a9c8ff'].map((c) => [0.3, 0.6, 1].map((t) => px(mix('#090d1c', c, t))));
  /* The name: gold from top to bottom, as the world's own banner, outlined. */
  const GOLD = ['#fff1b8', '#ffe08a', '#f8c95c', '#efb143', '#e09633', '#c97c26', '#aa621c'].map(px);
  const OUTLINE = px('#1a0f05'), SHADOW = px('#050308');
  const BAYER = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];
  /* Five by seven letters: each glyph's seven rows, one base-32 digit apiece. */
  const FONT = Object.fromEntries(('Aehhvhhh Buhhuhhu Cehggghe Duhhhhhu Evgguggv Fvgguggg Gehgnhhf Hhhhvhhh Ie44444e J72222ic '
    + 'Khikokih Lggggggv Mhrllhhh Nhhpljhh Oehhhhhe Puhhuggg Qehhhlid Ruhhukih Sfgge11u Tv444444 Uhhhhhhe Vhhhhha4 '
    + 'Whhhllla Xhha4ahh Yhha4444 Zv1248gv 0ehjlphe 14c4444e 2eh1248v 3v2421he 426aiv22 5vgu11he 668guhhe 7v124888 '
    + "8ehhehhe 9ehhf12c -000v000 .00000cc '4480000 ~008l200 !4444404 ?eh12404").split(' ')
    .map((s) => [s[0], [...s.slice(1)].map((d) => parseInt(d, 32))]));

  const ARRIVE_MS = 1100, RUSH = 0.45;
  /* Travelling, held still by a notice, arriving, or out of the way. */
  let mode = automated ? 'gone' : 'travel';
  let W = 0, H = 0, P = 3, cx = 0, cy = 0, R = 20, image = null, buf = null, back = null;
  let name = root.dataset.name || 'Glurff', title = null, titleY = 0;
  let want = 0, shown = 0, speed = 0.22, spin = 0, last = 0, frame = 0;
  let arriveAt = 0, where = null, landed = null, finish = () => {};
  let sprite = null;

  const stars = Array.from({ length: 240 }, () => ({}));
  const spawn = (s, far) => {
    const a = Math.random() * Math.PI * 2, d = 0.08 + Math.random() * 0.92;
    s.x = Math.cos(a) * d; s.y = Math.sin(a) * d; s.z = far ? 1 : 0.05 + Math.random() * 0.95;
    s.c = STARS[(Math.random() * STARS.length) | 0]; s.tw = Math.random() * 6.3;
  };
  for (const s of stars) spawn(s, false);

  const put = (x, y, c) => { if (x >= 0 && y >= 0 && x < W && y < H) buf[y * W + x] = c; };
  function line(x0, y0, x1, y1, colours) {
    x0 = Math.round(x0); y0 = Math.round(y0); x1 = Math.round(x1); y1 = Math.round(y1);
    const dx = Math.abs(x1 - x0), dy = -Math.abs(y1 - y0), sx = x0 < x1 ? 1 : -1, sy = y0 < y1 ? 1 : -1;
    const n = Math.max(dx, -dy) || 1;
    let err = dx + dy, i = 0;
    for (;;) {
      put(x0, y0, colours[Math.min(2, ((i++ / n) * 3) | 0)]);
      if (x0 === x1 && y0 === y1) return;
      const e2 = 2 * err;
      if (e2 >= dy) { err += dy; x0 += sx; }
      if (e2 <= dx) { err += dx; y0 += sy; }
    }
  }

  /* THE NAME in pixels, T to a letter's pixel, outlined and shadowed; null if
   * it has a letter this font lacks, and then the page's own text shows it. */
  function paintName(text, T) {
    const chars = [...text.toUpperCase()];
    if (!chars.length || chars.some((c) => c !== ' ' && !FONT[c])) return null;
    const w = (chars.length * 6 - 1) * T + 2, h = 7 * T + 3, data = new Uint32Array(w * h);
    chars.forEach((c, i) => {
      const rows = FONT[c]; if (!rows) return;
      rows.forEach((bits, row) => {
        for (let col = 0; col < 5; col++) if (bits & (16 >> col))
          for (let y = 0; y < T; y++) for (let x = 0; x < T; x++) data[(1 + row * T + y) * w + 1 + (i * 6 + col) * T + x] = GOLD[row];
      });
    });
    const filled = data.slice();
    for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
      if (filled[y * w + x]) continue;
      let edge = false;
      for (let j = -1; j <= 1 && !edge; j++) for (let i = -1; i <= 1; i++) {
        const xx = x + i, yy = y + j;
        if (xx >= 0 && yy >= 0 && xx < w && yy < h && filled[yy * w + xx]) { edge = true; break; }
      }
      if (edge) data[y * w + x] = OUTLINE;
      else if (y > 0 && filled[(y - 1) * w + x] === 0 && data[(y - 1) * w + x] === OUTLINE) data[y * w + x] = SHADOW;
    }
    return { w, h, data };
  }

  /* THE PLANET at radius r, turned by `spin`: a soft glow, the far half of its
   * ring, the globe lit from the upper left and dithered between its shades,
   * then the near half of the ring across it -- the Glurff icon's planet. */
  function paintPlanet(r, turn) {
    const glow = Math.ceil(r * 0.14) + 1, rx = r * 1.78, ry = r * 0.34;
    const w = 2 * Math.max(Math.ceil(rx) + 2, r + glow) + 1, h = 2 * (r + glow) + 1, ox = w >> 1, oy = h >> 1;
    if (!sprite || sprite.w !== w || sprite.h !== h) sprite = { w, h, ox, oy, data: new Uint32Array(w * h) };
    const data = sprite.data; data.fill(0);
    const set = (x, y, c) => { if (x >= 0 && y >= 0 && x < w && y < h) data[y * w + x] = c; };
    for (let y = -r - glow; y <= r + glow; y++) for (let x = -r - glow; x <= r + glow; x++) {
      const d = Math.hypot(x, y);
      if (d > r && d <= r + glow && BAYER[(y & 3) * 4 + (x & 3)] / 16 > (d - r) / glow) set(ox + x, oy + y, GLOW);
    }
    const tilt = -14 * Math.PI / 180, ct = Math.cos(tilt), st = Math.sin(tilt);
    const band = Math.max(1.2 / rx, 0.07), step = 0.45 / rx;
    const ring = (front) => {
      for (let k = 1 - band; k <= 1.0001; k += 0.5 / rx) for (let t = 0; t < Math.PI * 2; t += step) {
        if ((Math.sin(t) > 0) !== front) continue;
        const ex = k * rx * Math.cos(t), ey = k * ry * Math.sin(t);
        set(ox + Math.round(ex * ct - ey * st), oy + Math.round(ex * st + ey * ct), front ? RING[k > 1 - band / 2 ? 1 : 0] : RING_BACK);
      }
    };
    ring(false);
    const L = [-0.55, -0.5, 0.67];
    for (let y = -r; y <= r; y++) for (let x = -r; x <= r; x++) {
      const d2 = x * x + y * y; if (d2 > r * r) continue;
      const nx = x / r, ny = y / r, nz = Math.sqrt(Math.max(0, 1 - nx * nx - ny * ny));
      const lit = Math.max(0, nx * L[0] + ny * L[1] + nz * L[2]);
      const lon = Math.atan2(nx, nz) + turn, lat = Math.asin(Math.max(-1, Math.min(1, ny)));
      const n = Math.sin(lon * 2 + 0.6 * Math.sin(lat * 3)) * 0.5 + Math.sin(lon * 3.3 - lat * 2.1 + 1.7) * 0.35 + Math.sin(lat * 4.5 + lon) * 0.25;
      const shades = n > 0.35 ? LAND : SEA;
      const v = (0.12 + 0.88 * lit) * shades.length + BAYER[(y & 3) * 4 + (x & 3)] / 16 - 0.5;
      set(ox + x, oy + y, shades[Math.max(0, Math.min(shades.length - 1, Math.floor(v)))]);
    }
    ring(true);
  }
  /* The planet drawn at radius r: exact while small, and past CAP its pixels
   * simply grow, as anything does that close. */
  const CAP = 64;
  function drawPlanet(r) {
    const rs = Math.max(4, Math.min(CAP, Math.round(r))), s = r <= CAP ? 1 : r / rs;
    paintPlanet(rs, spin);
    const { w, h, ox, oy, data } = sprite;
    const x0 = Math.max(0, Math.floor(cx - (ox + 0.5) * s)), x1 = Math.min(W, Math.ceil(cx + (w - ox) * s));
    const y0 = Math.max(0, Math.floor(cy - (oy + 0.5) * s)), y1 = Math.min(H, Math.ceil(cy + (h - oy) * s));
    for (let y = y0; y < y1; y++) {
      const sy = Math.floor((y + 0.5 - cy) / s + oy + 0.5); if (sy < 0 || sy >= h) continue;
      for (let x = x0; x < x1; x++) {
        const sx = Math.floor((x + 0.5 - cx) / s + ox + 0.5); if (sx < 0 || sx >= w) continue;
        const c = data[sy * w + sx]; if (c) buf[y * W + x] = c;
      }
    }
  }

  /* Sizes: the planet, the name under it and the words under that, as one
   * group in the middle of the screen. */
  function layout() {
    if (plain) { root.classList.add('loading-plain', 'loading-quiet'); sky.hidden = true; card.style.top = ''; return; }
    P = Math.min(innerWidth, innerHeight) < 600 ? 2 : 3;
    W = Math.max(1, Math.ceil(innerWidth / P)); H = Math.max(1, Math.ceil(innerHeight / P));
    sky.width = W; sky.height = H; sky.style.width = `${W * P}px`; sky.style.height = `${H * P}px`;
    image = g.createImageData(W, H); buf = new Uint32Array(image.data.buffer);
    back = new Uint32Array(H);
    for (let y = 0; y < H; y++) back[y] = px(mix(SPACE_TOP, SPACE_BOTTOM, y / H));
    title = paintName(name, W >= 260 ? 3 : 2);
    if (!title) title = paintName(name, 2);
    if (title && title.w > W - 8) title = null;
    root.classList.toggle('loading-plain', !title);
    /* "Traveling to", small, over the name (2026-11-10): room for it, in
     * sky pixels, between the planet and the name. */
    const toH = title ? Math.ceil(18 / P) : 0;
    const cardH = card.offsetHeight / P, titleH = title ? title.h + 6 + toH : 0;
    R = Math.round(Math.max(12, Math.min(56, W * 0.25, (H * 0.86 - titleH - cardH - 10) / 2.3)));
    const top = Math.round((H - (2.3 * R + titleH + cardH + 10)) / 2);
    cx = W >> 1; cy = top + Math.round(1.15 * R);
    titleY = cy + Math.round(1.15 * R) + 6 + toH;
    card.style.top = `${Math.round((titleY + (title ? title.h : 0) + 4) * P)}px`;
    card.style.setProperty('--title-h', `${Math.round(((title ? title.h : 0) + 4) * P)}px`);
  }

  const ease = (t) => t * t * (3 - 2 * t);
  function draw(now, dt) {
    if (plain) return;
    for (let y = 0, i = 0; y < H; y++) { const c = back[y]; for (let x = 0; x < W; x++) buf[i++] = c; }
    const arriving = mode === 'arriving', k = arriving ? (now - arriveAt) / ARRIVE_MS : 0;
    const target = arriving ? 2.6 : mode === 'held' ? 0.03 : 0.22;
    speed += (target - speed) * Math.min(1, dt * (arriving ? 6 : 2));
    const F = Math.max(W, H) * 0.35;
    for (const s of stars) {
      if (still) { if (Math.sin(now / 900 + s.tw) > -0.6) put(Math.round(cx + (s.x / s.z) * F), Math.round(cy + (s.y / s.z) * F), s.c[s.z < 0.4 ? 2 : 1]); continue; }
      s.z -= speed * dt;
      const hx = cx + (s.x / s.z) * F, hy = cy + (s.y / s.z) * F;
      if (s.z < 0.02 || hx < -2 || hy < -2 || hx > W + 2 || hy > H + 2) { spawn(s, true); continue; }
      const tz = Math.min(1.2, s.z + speed * 0.09), tx = cx + (s.x / tz) * F, ty = cy + (s.y / tz) * F;
      const near = s.z < 0.35 ? 2 : s.z < 0.7 ? 1 : 0;
      line(tx, ty, hx, hy, [s.c[0], s.c[Math.max(0, near - 1)], s.c[near]]);
    }
    if (!still) spin += dt * (arriving ? 0.9 : 0.12);
    shown += (want - shown) * Math.min(1, dt * 3);
    const travel = R * (0.55 + 0.45 * ease(Math.min(1, shown)));
    let r = travel;
    if (arriving && !still) {
      const fill = Math.hypot(Math.max(cx, W - cx), Math.max(cy, H - cy)) + 2;
      r = k < RUSH ? travel * Math.pow(fill / travel, k / RUSH * (k / RUSH)) : fill;
    }
    drawPlanet(r);
    if (title && !arriving) {
      const x0 = cx - (title.w >> 1);
      for (let y = 0; y < title.h; y++) for (let x = 0; x < title.w; x++) { const c = title.data[y * title.w + x]; if (c) put(x0 + x, titleY + y, c); }
    }
    /* Through the planet's surface to the world: a hole opening round us. */
    if (arriving && !still && k >= RUSH) {
      const p = where?.() ?? null, hx = p ? p.x / P : cx, hy = p ? p.y / P : cy;
      const far = Math.hypot(Math.max(hx, W - hx), Math.max(hy, H - hy)) + 4, hole = ease(Math.min(1, (k - RUSH) / (1 - RUSH))) * far;
      for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
        const d = Math.hypot(x - hx, y - hy);
        if (d < hole - 2) buf[y * W + x] = 0; else if (d < hole) buf[y * W + x] = RIM;
      }
    }
    g.putImageData(image, 0, 0);
  }

  function tick(now) {
    frame = 0;
    if (mode === 'gone') return;
    const dt = Math.min(0.05, last ? (now - last) / 1000 : 0); last = now;
    if (mode === 'arriving' && now - arriveAt >= (still ? 380 : ARRIVE_MS)) { done(); return; }
    draw(now, dt);
    frame = requestAnimationFrame(tick);
  }
  const run = () => { if (!frame && mode !== 'gone') { last = 0; frame = requestAnimationFrame(tick); } };
  function done() {
    mode = 'gone'; root.hidden = true; root.setAttribute('aria-busy', 'false');
    root.classList.remove('arriving', 'returning');
    if (frame) cancelAnimationFrame(frame); frame = 0;
    removeEventListener('pointerdown', skip, true); removeEventListener('keydown', skip, true);
    finish(); landed = null;
  }
  const skip = () => { if (mode === 'arriving') done(); };

  const say = (words) => { if (typeof words === 'string') $('.loading-say').textContent = words; };
  window.glurffLoading = {
    get mode() { return mode; },
    to(destination, host) {
      if (typeof destination === 'string' && destination.trim()) {
        name = destination.trim(); $('.loading-name').textContent = name; root.dataset.name = name;
      }
      $('.loading-host').textContent = host ? `hosted by ${host}` : '';
      if (mode !== 'gone') layout();
    },
    progress(f, words) {
      want = Math.max(want, Math.max(0, Math.min(1, +f || 0)));
      const bar = $('.loading-bar');
      bar.style.setProperty('--done', `${Math.round(want * 100)}%`); bar.setAttribute('aria-valuenow', String(Math.round(want * 100)));
      say(words);
    },
    notice(n) {
      const box = $('.loading-notice'), act = $('.loading-act');
      box.hidden = !n?.title;
      root.classList.toggle('held', !!n?.stop);
      if (mode === 'travel' || mode === 'held') mode = n?.stop ? 'held' : 'travel';
      if (!n) { if (mode !== 'gone') layout(); return; }
      $('.loading-title').textContent = n.title ?? ''; $('.loading-detail').textContent = n.detail ?? '';
      act.hidden = !n.action;
      if (n.action) { act.textContent = n.action.label; act.onclick = () => n.action.run(); }
      if (mode !== 'gone') layout();
    },
    land(fn) {
      if (mode === 'gone') return Promise.resolve();
      if (landed) return landed;
      where = typeof fn === 'function' ? fn : null;
      landed = new Promise((resolve) => { finish = resolve; });
      mode = 'arriving'; arriveAt = performance.now();
      root.classList.add('arriving'); root.classList.toggle('still', still);
      addEventListener('pointerdown', skip, true); addEventListener('keydown', skip, true);
      run();
      return landed;
    },
    show() {
      if (mode !== 'gone' || automated) return;
      /* Out again, the way starts again: the bar from empty (2026-11-10). */
      want = 0; shown = 0;
      $('.loading-bar').style.setProperty('--done', '0%');
      mode = 'held'; root.hidden = false; root.setAttribute('aria-busy', 'true');
      root.classList.add('returning'); root.classList.remove('arriving');
      layout(); run();
    },
  };

  if (mode === 'gone') { root.hidden = true; return; }
  layout(); run();
  addEventListener('resize', () => { if (mode !== 'gone') layout(); });
})();
