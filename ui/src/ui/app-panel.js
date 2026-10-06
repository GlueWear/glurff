/* APPS AT A SPOT: a place on the map that opens an app.
 *
 * The app is a desk the player runs on THEIR OWN ship -- a browser can only
 * open apps from the ship it is logged in to -- exactly as Noltbook's plugins
 * work, and with the same conventions, so any Noltbook plugin works from a
 * spot too:
 *
 *   installed   the app opens in a frame, from where docket says it lives
 *               (usually /apps/<desk>). WITH a noltbook.json there, sized by
 *               it and with Noltbook's frame permissions -- a "media" app may
 *               reach its own agent (allow-same-origin), a "pointer-lock" app
 *               may hold the mouse -- only what it declares, and told the
 *               spot's context. WITHOUT one, as Landscape would open it: able
 *               to reach its own agent, since installing it was the trust, but
 *               nothing extra and no context.
 *               The page is told where it was opened -- the spot's context,
 *               e.g. which table -- through Noltbook's plugin handshake
 *               (nb:ready -> nb:init) and in its address, and may ask to be
 *               resized (nb:resize) or closed (nb:close).
 *   missing     the app's card -- name, words, picture, publisher -- and a
 *               button to get it: learn of it from its publisher (%treaty),
 *               install it (%docket), and open it once it is running.
 *
 * What a spot opens is an attribute of the spot (see world/hotspots): today it
 * is written into the map; a builder will set it later.
 */
import { api, poke as pokeShip } from 'lib/api';
import { esc } from 'ui/html';

import { PLUGIN_PROTOCOL, FRAME_ALLOW, deskOk, shipOk, chadOf, running, colorHex, frameSandbox, frameGrants, manifestPerm, launchHref, frameSize,
  appRoot, INSTALLED_GRANTS, bigSize } from 'lib/app-spots';
export { PLUGIN_PROTOCOL, FRAME_ALLOW, deskOk, shipOk, chadOf, running, colorHex, frameSandbox, frameGrants, manifestPerm, launchHref, frameSize,
  appRoot, INSTALLED_GRANTS, bigSize };
/* The title bar's enlarge and restore buttons. */
const ENLARGE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7"/></svg>';
const RESTORE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/></svg>';
const TREATY_WAIT_MS = 10000, TREATY_STEP_MS = 1200;
const INSTALL_CHECKS = [1000, 3000, 6000, 10000, 16000, 25000, 40000, 60000, 90000, 120000];

export class AppPanel {
  constructor(root, {
    scry = (app, path) => api.scry({ app, path }),
    poke = (app, mark, json) => pokeShip(app, mark, json),
    fetchJson = async (url) => {
      const ctrl = new AbortController(), timer = setTimeout(() => ctrl.abort(), 1800);
      try { const r = await fetch(url, { credentials: 'include', cache: 'no-store', signal: ctrl.signal }); return r.ok ? await r.json() : null; }
      catch { return null; } finally { clearTimeout(timer); }
    },
    wait = (ms) => new Promise((r) => setTimeout(r, ms)),
    trace = () => {},
    world = '',
  } = {}) {
    Object.assign(this, { root, scry, poke, fetchJson, wait, trace, world });
    this.spot = null; this.state = 'closed'; this.session = null; this.frame = null; this.run = 0;
    root.className = 'app-panel'; root.hidden = true;
    root.setAttribute('role', 'dialog');
    root.innerHTML = '<div class="app-head"><span class="app-title"></span><span class="app-tools">' +
      '<button type="button" class="app-max" hidden></button><button type="button" class="app-x" title="Close">&times;</button></span></div><div class="app-body"></div>';
    this.titleEl = root.querySelector('.app-title');
    this.body = root.querySelector('.app-body');
    root.querySelector('.app-x').onclick = () => this.close();
    /* ENLARGE: the app as large as the window allows, and back to the size it
     * asked for. Only while an app is showing; every app starts at its own. */
    this.maxBtn = root.querySelector('.app-max');
    this.maxBtn.onclick = () => this.setBig(!this.big);
    this.big = false; this.size = null;
    this.setBig(false);
    window.addEventListener('resize', () => { if (this.big) this.fit(); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && !this.root.hidden) this.close(); });
    window.addEventListener('message', (e) => this.onMessage(e));
  }

  /* Open what a spot opens: {desk, publisher, title, context}. */
  async open(app) {
    if (!deskOk(app?.desk)) return;
    const run = ++this.run;
    this.spot = app;
    this.root.hidden = false;
    this.titleEl.textContent = app.title || app.desk;
    this.say('Opening…');
    this.trace('app-spot', { reason: 'open', detail: app.desk });
    const charge = await this.charge(app.desk);
    if (run !== this.run) return;
    if (running(charge)) return this.play(app, run, charge);
    this.card(app, charge);
  }

  close() {
    this.run++;
    this.root.hidden = true;
    this.maxBtn.hidden = true; this.setBig(false);
    this.body.innerHTML = '';
    this.frame = null; this.session = null; this.spot = null; this.context = null; this.state = 'closed';
    this.root.style.width = this.root.style.height = '';
  }

  say(text, cls = 'dim') { this.state = 'busy'; this.maxBtn.hidden = true; this.body.innerHTML = `<div class="app-note ${cls}">${esc(text)}</div>`; }

  /* Enlarged or not, the frame is drawn at that size. */
  setBig(on) {
    this.big = !!on;
    this.maxBtn.innerHTML = this.big ? RESTORE : ENLARGE;
    const label = this.big ? 'Restore' : 'Enlarge';
    this.maxBtn.title = label; this.maxBtn.setAttribute('aria-label', label);
    this.maxBtn.setAttribute('aria-pressed', String(this.big));
    this.fit();
  }
  fit() {
    if (!this.frame) return;
    const head = this.root.querySelector('.app-head')?.offsetHeight || 32;
    const size = this.big ? bigSize({ width: innerWidth, height: innerHeight }, head) : this.size;
    if (!size) return;
    this.frame.style.width = size.width + 'px'; this.frame.style.height = size.height + 'px';
  }

  async charge(desk) {
    try { return (await this.scry('docket', '/charges'))?.initial?.[desk] ?? null; } catch { return null; }
  }

  /* ---- installed: the app, in a frame ---- */
  async play(app, run, charge = null) {
    const root = appRoot(app.desk, charge);
    const manifest = await this.fetchJson(`${root}/noltbook.json`);
    if (run !== this.run) return;
    /* With a manifest, what it declares and the spot's context; without, what
     * installing it gave, and no context. */
    const { media, pointerLock } = manifest ? frameGrants(manifest) : INSTALLED_GRANTS;
    this.context = manifest ? (app.context ?? {}) : {};
    const size = frameSize(manifest, { width: innerWidth, height: innerHeight });
    this.state = 'playing';
    this.session = `glurff-${Math.random().toString(36).slice(2, 10)}`;
    this.body.innerHTML = '';
    const frame = document.createElement('iframe');
    frame.className = 'app-frame';
    frame.setAttribute('sandbox', frameSandbox(media, pointerLock));
    if (media) { frame.setAttribute('allow', FRAME_ALLOW); frame.setAttribute('allowfullscreen', ''); }
    frame.src = launchHref(app.desk, manifest, this.context, location.origin, root);
    this.frame = frame;
    this.size = size;
    this.big = false;
    this.setBig(false);
    this.maxBtn.hidden = false;
    this.body.appendChild(frame);
    this.trace('app-spot', { reason: 'frame', detail: `${app.desk}:${!manifest ? 'installed' : media ? 'media' : 'plain'}${pointerLock ? '+pointer-lock' : ''}` });
  }

  /* Noltbook's plugin handshake, from the frame we opened only. */
  onMessage(e) {
    if (!this.frame || e.source !== this.frame.contentWindow) return;
    const d = e.data;
    if (!d || typeof d !== 'object' || d.source !== 'noltbook-plugin' || d.protocol !== PLUGIN_PROTOCOL) return;
    if (d.type === 'nb:ready') {
      this.send('nb:init', { mode: 'embedded-app', desk: this.spot.desk, context: this.context ?? {},
        host: { app: 'glurff', world: this.world } });
      return;
    }
    if (d.session !== this.session) return;
    if (d.type === 'nb:close') { this.close(); return; }
    if (d.type === 'nb:resize') {
      const p = d.payload ?? {};
      /* The size it asks for is its own size; enlarged, it stays enlarged. */
      this.size = frameSize({ launch: { width: Number(p.width) || this.size?.width, height: Number(p.height) || this.size?.height } },
        { width: innerWidth, height: innerHeight });
      this.fit();
    }
  }
  send(type, payload) {
    try { this.frame.contentWindow.postMessage({ source: 'noltbook-host', protocol: PLUGIN_PROTOCOL, session: this.session, type, payload }, '*'); } catch {}
  }

  /* ---- not installed: its card, and a way to get it ---- */
  async card(app, charge, error = '') {
    const run = this.run;
    const pub = shipOk(app.publisher) ? app.publisher : null;
    const info = charge ?? (pub ? await this.treaty(pub, app.desk) : null) ?? {};
    if (run !== this.run) return;
    const chad = chadOf(charge);
    const title = info.title || app.title || app.desk;
    const col = colorHex(info.color), img = typeof info.image === 'string' ? info.image : '';
    this.state = 'card';
    this.maxBtn.hidden = true;
    const why = chad === 'install' ? 'Installing…' : chad === 'suspend' ? `${title} is installed but suspended. Resume it in Landscape.`
      : chad === 'hung' ? `${title} is installed but stuck. Check it in Landscape.` : '';
    this.body.innerHTML = `<div class="app-card">
      <div class="app-icon" style="background:${esc(col || '#2a2a2a')}">${img ? `<img src="${esc(img)}" alt="">` : ''}</div>
      <div class="app-words"><div class="app-name">${esc(title)}</div>
        ${info.info ? `<div class="app-info">${esc(info.info)}</div>` : ''}
        ${pub ? `<div class="dim">from ${esc(pub)}</div>` : ''}
        <div class="app-status ${error ? 'bad' : 'dim'}">${esc(error || why || `You need ${title} to play here.`)}</div>
        ${pub && !chad ? `<button type="button" class="app-get">GET ${esc(title.toUpperCase())}</button>` : ''}
      </div></div>`;
    const img0 = this.body.querySelector('.app-icon img');
    if (img0) img0.onerror = () => { img0.remove(); };
    const get = this.body.querySelector('.app-get');
    if (get) get.onclick = () => this.install(app);
    if (chad === 'install') this.watchInstall(app, this.run);
  }

  async treaty(pub, desk) {
    try { return await this.scry('treaty', `/treaty/${pub}/${desk}`); } catch { return null; }
  }

  /* Learn of it from its publisher, install it, and open it once it runs. */
  async install(app) {
    const run = this.run, pub = app.publisher, desk = app.desk;
    const status = (t) => { const el = this.body.querySelector('.app-status'); if (el) { el.textContent = t; el.classList.remove('bad'); } };
    const get = this.body.querySelector('.app-get'); if (get) get.disabled = true;
    this.trace('app-spot', { reason: 'install', detail: `${pub}/${desk}` });
    status(`Finding ${app.title || desk} on ${pub}…`);
    let known = !!(await this.treaty(pub, desk));
    if (!known) {
      try { await this.poke('treaty', 'ally-update-0', { add: pub }); } catch { return this.fail(app, run, 'Could not reach its publisher.'); }
      for (let t = 0; t < TREATY_WAIT_MS && !known; t += TREATY_STEP_MS) {
        await this.wait(TREATY_STEP_MS);
        if (run !== this.run) return;
        known = !!(await this.treaty(pub, desk));
      }
    }
    if (!known) return this.fail(app, run, `Could not find ${desk} on ${pub}.`);
    status('Installing…');
    try { await this.poke('docket', 'docket-install', `${pub}/${desk}`); } catch { return this.fail(app, run, 'The install request failed.'); }
    this.watchInstall(app, run);
  }

  async watchInstall(app, run) {
    let last = 0;
    for (const at of INSTALL_CHECKS) {
      await this.wait(at - last); last = at;
      if (run !== this.run) return;
      const charge = await this.charge(app.desk);
      if (running(charge)) { this.trace('app-spot', { reason: 'installed', detail: app.desk }); return this.play(app, run, charge); }
      if (['hung', 'suspend'].includes(chadOf(charge))) return this.card(app, charge);
    }
    this.fail(app, run, 'Installing is taking a while. It will open next time once it has finished.');
  }

  fail(app, run, text) {
    if (run !== this.run) return;
    this.trace('app-spot', { reason: 'failed', detail: text.slice(0, 60) });
    this.card(app, null, text);
  }
}
