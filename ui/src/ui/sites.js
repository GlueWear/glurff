/* THE APPS BUTTON, `%`, after the room button (2026-11-08; it was a
 * magnifying glass): every app placed in this Glurff, and every app on our
 * own ship, each opening on our stage (ui/stage) -- for us alone.
 *
 *   a word        the apps whose names match; Enter opens the only one
 *   below         the apps in this Glurff, then the apps on our ship
 *
 * Websites -- pasting an address, the sites opened lately -- are still here,
 * switched off (`web`), not taken out:
 *
 *   an address    https://… or just example.com; Enter opens it
 *
 * The first visit to a site asks once (and is remembered, with the recent
 * sites, in our own settings on our ship -- they follow us to any browser). A
 * site that cannot be shown here says why, and offers a button to open it in a
 * new tab; nothing ever opens one by itself. See lib/sites.
 */
import { esc } from 'ui/html';
import { siteFrom, sitesOf, remembered, allowedSite } from 'lib/sites';
import { tileInk } from 'lib/app-spots';

const LENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';
/* An app is a desk, and a desk is written with a %. */
const PERCENT = '<span class="sites-percent" aria-hidden="true">%</span>';

export class Sites {
  /* games(): [{id, title, kind: 'app' | 'web', open()}] -- what in this world
   * opens something. installed(): a promise of our ship's apps, [{desk,
   * title, color, image}]; openInstalled(app) puts one on the stage.
   * settings: our saved settings (lib/clocks). openWeb: put a checked site on
   * the stage. ask: Glurff's own question box. web: websites too. */
  constructor(root, { games = () => [], installed = async () => [], openInstalled = () => {}, settings, openWeb, ask, origin = location.origin, web = false } = {}) {
    Object.assign(this, { root, games, installed, openInstalled, settings, openWeb, ask, origin, web });
    this.open = false; this.ours = []; this.looking = false;
    root.className = 'sites';
    root.innerHTML = (web ? `
      <button type="button" class="sites-btn" data-tip="Games &amp; websites" aria-label="Search games, or open a website" aria-expanded="false" aria-haspopup="true">${LENS}</button>
      <div class="sites-panel" hidden>
        <form class="sites-form"><input class="sites-input" type="text" inputmode="url" enterkeyhint="go" autocomplete="off" spellcheck="false"
          placeholder="Search games, or paste a website"></form>` : `
      <button type="button" class="sites-btn" data-tip="Apps" aria-label="Apps in this Glurff and on your ship" aria-expanded="false" aria-haspopup="true">${PERCENT}</button>
      <div class="sites-panel" hidden>
        <form class="sites-form"><input class="sites-input" type="search" enterkeyhint="go" autocomplete="off" spellcheck="false"
          placeholder="Find an app"></form>`) + `
        <div class="sites-status" role="status" hidden></div>
        <div class="sites-list"></div>
      </div>`;
    this.btn = root.querySelector('.sites-btn');
    this.panel = root.querySelector('.sites-panel');
    this.input = root.querySelector('.sites-input');
    this.status = root.querySelector('.sites-status');
    this.list = root.querySelector('.sites-list');
    this.btn.onclick = () => this.toggle(!this.open);
    this.input.addEventListener('input', () => { this.say(''); this.paint(); });
    root.querySelector('.sites-form').onsubmit = (e) => { e.preventDefault(); this.go(); };
    this.list.addEventListener('click', (e) => this.choose(e));
    this.status.addEventListener('click', (e) => {
      const b = e.target.closest('.sites-newtab');
      if (b) window.open(b.dataset.url, '_blank', 'noopener');
    });
    document.addEventListener('pointerdown', (e) => { if (this.open && !root.contains(e.target)) this.toggle(false); });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.open) this.toggle(false); });
  }

  toggle(open) {
    this.open = open;
    this.btn.setAttribute('aria-expanded', String(open));
    this.panel.hidden = !open;
    if (!open) return;
    this.input.value = ''; this.say(''); this.paint();
    this.input.focus({ preventScroll: true });
    /* Our ship's apps, asked again each time: one may have been installed. */
    if (!this.web) this.lookUp();
  }

  /* Our ship's apps; asked again a few times, while the panel is open, if
   * our ship could not be asked -- a browser busy with other requests to
   * it, say. */
  lookUp(tries = 5) {
    this.looking = true;
    const done = (list) => {
      if (!list && tries > 1 && this.open) { setTimeout(() => { if (this.open) this.lookUp(tries - 1); }, 2000); return; }
      this.looking = false; this.unasked = !list && !this.ours.length;
      if (list) this.ours = list;
      if (this.open) this.paint();
    };
    this.installed().then(done, () => done(null));
  }
  /* Something shown here changed -- an app's picture arrived, say. */
  refresh() { if (this.open) this.paint(); }

  sites() { return sitesOf(this.settings?.get?.()); }

  /* The world's games matching the box, and our recent sites -- or, without
   * websites, the world's apps and our own. */
  matches() {
    const q = this.input.value.trim().toLowerCase();
    const games = this.games().filter((g) => (this.web || g.kind === 'app') && (!q || g.title.toLowerCase().includes(q)));
    const recent = this.web ? this.sites().recent.filter((r) => !q || r.url.toLowerCase().includes(q)) : [];
    const ours = this.web ? [] : this.ours.filter((a) => !q || a.title.toLowerCase().includes(q) || a.desk.includes(q));
    return { games, recent, ours };
  }

  paint() {
    const { games, recent, ours } = this.matches();
    if (!this.web) {
      /* The app's picture over its colour and first letter, which show where
       * there is none or it will not load. An <img>, not a CSS url(): a
       * picture's address is whatever its publisher wrote. */
      const row = (a, attr, i) => `<button type="button" class="site-row app-row" ${attr}="${i}">
        <span class="app-tile" style="background:${esc(a.color || '#3a4152')};color:${tileInk(a.color || '#3a4152')}">${esc((a.title || '%').slice(0, 1))}${a.image ? `<img src="${esc(a.image)}" alt="" onerror="this.remove()">` : ''}</span>
        <span class="site-name">${esc(a.title)}</span><span class="dim">%${esc(a.desk)}</span></button>`;
      this.list.innerHTML =
        '<div class="sites-group">In this Glurff</div>' + (games.length ? games.map((g, i) => row({ title: g.title, desk: g.desk ?? '', image: g.image ?? '', color: '' }, 'data-game', i)).join('')
          : `<div class="dim pad">${this.input.value.trim() ? 'No app here by that name.' : 'No apps placed here yet.'}</div>`) +
        '<div class="sites-group">On your ship</div>' + (ours.length ? ours.map((a, i) => row(a, 'data-ours', i)).join('')
          : `<div class="dim pad">${this.input.value.trim() ? 'None by that name.' : this.looking ? 'Looking…'
            : this.unasked ? 'Your ship did not answer. Close this and open it again to try again.' : 'No apps on your ship.'}</div>`);
      this.shown = games; this.shownOurs = ours;
      return;
    }
    this.list.innerHTML =
      (games.length ? '<div class="sites-group">In this world</div>' + games.map((g, i) => `
        <button type="button" class="site-row" data-game="${i}"><span class="site-name">${esc(g.title)}</span>
          <span class="dim">${g.kind === 'web' ? 'website' : 'game'}</span></button>`).join('') : '') +
      (recent.length ? '<div class="sites-group">Recent</div>' + recent.map((r) => `
        <button type="button" class="site-row" data-url="${esc(r.url)}"><span class="site-name">${esc(r.host)}</span>
          <span class="dim site-url">${esc(r.url.replace(/^https:\/\//, ''))}</span></button>`).join('') : '') ||
      '<div class="dim pad">Nothing here yet. Paste a website to open it.</div>';
    this.shown = games;
  }

  choose(e) {
    const row = e.target.closest('.site-row');
    if (!row) return;
    if (row.dataset.game !== undefined) { const g = this.shown[Number(row.dataset.game)]; if (g) { this.toggle(false); g.open(); } return; }
    if (row.dataset.ours !== undefined) { const a = this.shownOurs[Number(row.dataset.ours)]; if (a) { this.toggle(false); this.openInstalled(a); } return; }
    void this.visit(row.dataset.url);
  }

  /* Enter: an address opens; a word opens the one game it names. */
  go() {
    const text = this.input.value.trim();
    if (!text) return;
    if (!this.web) {
      const { games, ours } = this.matches(), all = [...games.map((g) => () => g.open()), ...ours.map((a) => () => this.openInstalled(a))];
      if (all.length === 1) { this.toggle(false); all[0](); return; }
      this.say(all.length ? 'More than one app matches. Pick one below.' : 'No app by that name.');
      return;
    }
    const site = siteFrom(text, this.origin);
    if (site.url || site.error !== 'bad') { void this.visit(text); return; }
    const { games } = this.matches();
    if (games.length === 1) { this.toggle(false); games[0].open(); return; }
    this.say(games.length ? 'More than one game matches. Pick one below.' : 'No game here by that name, and that isn’t a website address.');
  }

  say(text, url = null) {
    this.status.hidden = !text;
    this.status.innerHTML = text ? `<span>${esc(text)}</span>${url ? ` <button type="button" class="sites-newtab" data-url="${esc(url)}">Open in a new tab</button>` : ''}` : '';
  }

  /* Open a site: checked, asked about once, remembered, onto the stage. */
  async visit(input, title = null) {
    const site = siteFrom(input, this.origin);
    if (site.error === 'http') { this.toggle(true); this.say('This site uses plain http, which can’t be shown inside Glurff.', site.url); return false; }
    if (site.error === 'self') { this.toggle(true); this.say('That’s on your own ship. Open it from Landscape.'); return false; }
    if (!site.url) { this.toggle(true); this.say('That isn’t a website address.'); return false; }
    let sites = this.sites();
    if (!sites.allowed.includes(site.host)) {
      this.toggle(false);
      const yes = await this.ask(`Open ${site.host}?`, { yes: 'Open', no: 'Cancel',
        detail: 'It’s a website outside Urbit. It opens walled off from your ship, but like any website it can see your internet address.' });
      if (!yes) return false;
      sites = allowedSite(this.sites(), site.host);
    }
    sites = remembered(sites, site.url, site.host);
    this.settings?.update?.((s) => { s.sites = sites; return s; });
    this.toggle(false);
    this.openWeb({ url: site.url, host: site.host, title: title || site.host });
    return true;
  }
}
