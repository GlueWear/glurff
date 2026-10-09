/* THE MAGNIFYING GLASS, after the room button: search this world's games, or
 * paste any website, and it opens on our stage (ui/stage) -- for us alone.
 *
 *   a word        the world's games whose names match; Enter opens the only one
 *   an address    https://… or just example.com; Enter opens it
 *   below         this world's games, then the sites we opened lately
 *
 * The first visit to a site asks once (and is remembered, with the recent
 * sites, in our own settings on our ship -- they follow us to any browser). A
 * site that cannot be shown here says why, and offers a button to open it in a
 * new tab; nothing ever opens one by itself. See lib/sites.
 */
import { esc } from 'ui/html';
import { siteFrom, sitesOf, remembered, allowedSite } from 'lib/sites';

const LENS = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/></svg>';

export class Sites {
  /* games(): [{id, title, kind: 'app' | 'web', open()}] -- this world's spots
   * that open something. settings: our saved settings (lib/clocks). openWeb:
   * put a checked site on the stage. ask: Glurff's own question box. */
  constructor(root, { games = () => [], settings, openWeb, ask, origin = location.origin } = {}) {
    Object.assign(this, { root, games, settings, openWeb, ask, origin });
    this.open = false;
    root.className = 'sites';
    root.innerHTML = `
      <button type="button" class="sites-btn" title="Search games, or open a website" aria-label="Search games, or open a website" aria-expanded="false" aria-haspopup="true">${LENS}</button>
      <div class="sites-panel" hidden>
        <form class="sites-form"><input class="sites-input" type="text" inputmode="url" enterkeyhint="go" autocomplete="off" spellcheck="false"
          placeholder="Search games, or paste a website"></form>
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
  }

  sites() { return sitesOf(this.settings?.get?.()); }

  /* The world's games matching the box, and our recent sites. */
  matches() {
    const q = this.input.value.trim().toLowerCase();
    const games = this.games().filter((g) => !q || g.title.toLowerCase().includes(q));
    const recent = this.sites().recent.filter((r) => !q || r.url.toLowerCase().includes(q));
    return { games, recent };
  }

  paint() {
    const { games, recent } = this.matches();
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
    void this.visit(row.dataset.url);
  }

  /* Enter: an address opens; a word opens the one game it names. */
  go() {
    const text = this.input.value.trim();
    if (!text) return;
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
