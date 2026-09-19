/* Direct messages, and search.
 *
 * Noltbook's, entirely. A DM is one of its notes; the list is its note list
 * filtered to type %dm, the unread dot is its durable read mark against its
 * unread activity, and every message goes through its post-message. Glurff
 * keeps no copy and adds no store -- close the world and the conversation is
 * still there in Noltbook, with the same history.
 *
 * Three pieces: a button in the top left that carries the dot, a panel that
 * lists conversations and searches the way Noltbook's sidebar does -- people
 * first -- and a small window for the conversation you are in. A note that is
 * not a DM opens in Noltbook itself: Glurff shows a chat column, not a whole
 * note.
 */
import {
  nb, dmList, dmWith, counterparty, anyUnreadDm, unread, displayName, avatarUrl,
  openDm, messagesFor, postMessage, markRead, subscribeNote, onChange,
  requestProfile, retryProfile, searchMessages, noteUrl,
} from 'lib/noltbook';
import { runSearch, normalizeSearch, MIN_BODY_QUERY } from 'lib/search';
import { our } from 'lib/api';

const esc = (s) => String(s ?? '').replace(/[&<>"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

const SEARCH_ICON = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 5 5"/></svg>';
const avatar = (ship) => `<span class="av">${avatarUrl(ship) ? `<img src="${esc(avatarUrl(ship))}" alt="">` : ''}</span>`;
const NOTE_TYPE = { gossip: 'gossip', group: 'group', notebook: 'note' };
const openNote = (id) => window.open(noteUrl(id), '_blank', 'noopener');

export class Dms {
  constructor(root, { onShowProfile } = {}) {
    this.root = root;
    this.root.className = 'dms';
    this.onShowProfile = onShowProfile ?? (() => {});
    this.panelOpen = false;
    this.query = '';
    this.searchReq = 0;      //  the message search whose answer we will show
    this.searchTimer = null;
    this.open = null;        //  {noteId, ship, unsub}
    this.root.innerHTML = `
      <button class="dm-btn" title="Search" aria-label="Search">${SEARCH_ICON}<i class="dot" hidden></i></button>
      <div class="dm-panel" hidden></div>
      <div class="dm-window" hidden></div>`;
    this.btn = this.root.querySelector('.dm-btn');
    this.panel = this.root.querySelector('.dm-panel');
    this.win = this.root.querySelector('.dm-window');
    this.btn.onclick = () => this.togglePanel();
    /* Clicking away closes the panel, the way every other menu here does --
     * having to find the button again to put it away was a trap. The open
     * conversation is left alone: that is a window, not a menu. */
    document.addEventListener('pointerdown', (e) => {
      if (this.panelOpen && !this.root.contains(e.target)) this.togglePanel();
    });
    window.addEventListener('keydown', (e) => { if (e.key === 'Escape' && this.panelOpen) this.togglePanel(); });
    /* The list, the dot, search results and the open conversation all follow
     * the store. */
    onChange(() => {
      if (this.frame != null) return;
      this.frame = requestAnimationFrame(() => { this.frame = null; this.paint(); });
    }, c => c.field === 'messages' ? c.noteId === this.open?.noteId :
      (this.panelOpen && this.query.trim() !== '' &&
        ['search', 'lookups', 'notes', 'profiles', 'pals', 'contacts'].includes(c.field)) ||
      (['notes', 'profiles', 'pals', 'contacts', 'reads', 'unreadAt', 'activity'].includes(c.field) &&
        (!c.noteId || nb.notes[c.noteId]?.type === 'dm')));
    this.paint();
  }

  togglePanel() {
    this.panelOpen = !this.panelOpen;
    this.query = '';
    clearTimeout(this.searchTimer);
    this.searchReq = 0;
    const input = this.panel.querySelector('input');
    if (input) input.value = '';
    this.paint();
    if (this.panelOpen) this.panel.querySelector('input')?.focus();
  }

  paint() {
    this.root.querySelector('.dot').hidden = !anyUnreadDm();
    this.panel.hidden = !this.panelOpen;
    if (this.panelOpen) this.paintPanel();
    this.win.hidden = !this.open;
    if (this.open) this.paintWindow();
  }

  search(value) {
    this.query = value;
    clearTimeout(this.searchTimer);
    this.searchReq = 0;
    const q = value.trim();
    /* Message bodies are searched on the ship, so wait for a pause in typing. */
    if (normalizeSearch(q).length >= MIN_BODY_QUERY)
      this.searchTimer = setTimeout(() => { this.searchReq = searchMessages(q); }, 250);
    this.paintPanel();
  }

  paintPanel() {
    /* Rebuilding the input under the caret would drop every second keystroke,
     * so the field is written once and only the list below it redraws. */
    if (!this.panel.querySelector('input')) {
      this.panel.innerHTML = '<input class="dm-search" placeholder="Search" aria-label="Search notes, messages and people" autocomplete="off"><div class="dm-list"></div>';
      const input = this.panel.querySelector('input');
      input.oninput = () => this.search(input.value);
    }
    const q = this.query.trim();
    const list = this.panel.querySelector('.dm-list');
    list.innerHTML = q ? this.results(q) : this.conversations();
    list.querySelectorAll('[data-act]').forEach((el) => { el.onclick = () => this.choose(el.dataset); });
  }

  /* Nothing typed: your conversations, newest first. */
  conversations() {
    return dmList().map((d) => `
      <div class="dm-row${d.unread ? ' unread' : ''}" data-act="dm" data-ship="${esc(d.ship)}">
        ${avatar(d.ship)}
        <span class="who">${esc(displayName(d.ship))}</span>
        <span class="prev dim">${esc(d.note.lastPreview ?? '')}</span>
        ${d.unread ? '<i class="dot"></i>' : ''}
      </div>`).join('') || '<div class="dim pad">no messages yet</div>';
  }

  results(q) {
    const answer = nb.search && this.searchReq && nb.search.reqId === this.searchReq ? nb.search : null;
    const r = runSearch(q, nb, { our, hits: answer });
    if (!r.notes.length && !r.messages.length && !r.people.length && !r.unknownShip && !r.tooShort && answer)
      return '<div class="dim pad">no matches</div>';
    const group = (title) => `<div class="dm-group">${title}</div>`;
    let html = '';
    /* PEOPLE FIRST. Searching in a world full of people is nearly always
     * searching for one of them; notes and message bodies are what you fall
     * through to. Noltbook separates the three the same way. */
    if (r.people.length || r.unknownShip) {
      html += group('people') + r.people.map((s2) => {
        const tag = nb.pals[s2] === 'blocked' ? 'blocked' : dmWith(s2) ? 'DM' : nb.pals[s2] === 'mutual' ? 'pals' : '';
        return `<div class="dm-row" data-act="person" data-ship="${esc(s2)}">
          ${avatar(s2)}
          <span class="who">${esc(displayName(s2))}</span><span class="prev dim">${esc(s2)}</span>
          ${tag ? `<span class="tag">${tag}</span>` : ''}
        </div>`;
      }).join('');
      if (r.unknownShip) html += `
        <div class="dm-row new" data-act="lookup" data-ship="${esc(r.unknownShip)}">
          ${avatar(r.unknownShip)}
          <span class="who">${esc(r.unknownShip)}</span><span class="prev dim">${esc(this.lookupText(r.unknownShip))}</span>
        </div>`;
    }
    if (r.notes.length) html += group('notes') + r.notes.map((n) => `
      <div class="dm-row" data-act="note" data-note="${esc(n.id)}">
        <span class="who">${esc(n.name)}</span><span class="prev dim">${esc(NOTE_TYPE[n.type] ?? '')}</span>
      </div>`).join('');
    html += group('messages');
    if (r.tooShort) html += '<div class="dim pad">type 2+ characters to search messages</div>';
    else if (!answer) html += '<div class="dim pad">searching…</div>';
    else if (!r.messages.length) html += '<div class="dim pad">no message matches</div>';
    else {
      html += r.messages.map((h) => {
        const note = nb.notes[h.noteId];
        const where = note ? (note.type === 'dm' ? displayName(counterparty(note)) : note.name) : h.noteId;
        return `<div class="dm-row hit" data-act="hit" data-note="${esc(h.noteId)}">
          ${avatar(h.author)}
          <span class="hit-text"><span><span class="who">${esc(displayName(h.author))}</span> <span class="dim">in</span> ${esc(where)}</span>
            <span class="prev dim">${esc(h.preview)}</span></span>
        </div>`;
      }).join('');
      if (r.capped) html += '<div class="dim pad">showing first 50 — refine your search</div>';
    }
    return html;
  }

  /* Whether somebody nobody here has heard of is out there, and on Noltbook. */
  lookupText(ship) {
    const status = nb.lookups[ship];
    if (status === 'looking') return 'looking… first contact can take ~20s';
    if (status === 'reachable') return 'online · looking for Noltbook…';
    if (status === 'noltbook-unavailable') return 'online · Noltbook not available';
    if (status === 'unreachable') return "couldn't reach — tap to retry";
    return 'look up';
  }

  /* What a result does is what it does in Noltbook: a person with a DM opens
   * it, anyone else opens their card; a DM message opens the conversation and
   * any other note opens in Noltbook. */
  choose({ act, note, ship }) {
    if (act === 'dm') { this.openWith(ship); return; }
    if (act === 'note') { openNote(note); return; }
    if (act === 'hit') {
      const n = nb.notes[note];
      if (n?.type === 'dm' && counterparty(n)) this.openWith(counterparty(n)); else openNote(note);
      return;
    }
    if (act === 'person') { if (dmWith(ship)) this.openWith(ship); else this.onShowProfile(ship); return; }
    if (act === 'lookup') {
      /* An unreachable ship is tried again; one without Noltbook is only shown. */
      if (nb.lookups[ship] === 'unreachable') retryProfile(ship);
      else if (!nb.lookups[ship]) requestProfile(ship);
      this.onShowProfile(ship);
      this.paintPanel();
    }
  }

  /* Open by ship rather than by note: if there is no conversation yet,
   * find-or-create-dm makes one, which is the same call Noltbook makes. */
  async openWith(ship) {
    if (this.open?.ship === ship) return;
    await this.closeWindow();
    let noteId = dmList().find((d) => d.ship === ship)?.note.id ?? null;
    if (!noteId) {
      try { noteId = await openDm(ship); } catch (e) { console.error('open dm', e); return; }
    }
    if (!noteId) return;
    if (!nb.profiles[ship]) requestProfile(ship);
    const unsub = await subscribeNote(noteId);
    this.open = { noteId, ship, unsub };
    this.built = null;
    this.panelOpen = false;
    this.paint();
    this.scrollDown();
  }

  async closeWindow() {
    if (!this.open) return;
    try { await this.open.unsub(); } catch (e) {}
    this.open = null;
    this.built = null;
    this.body = null;
  }

  paintWindow() {
    const { noteId, ship } = this.open;

    /* The shell is built once per conversation and the message list alone is
     * redrawn afterwards. Rebuilding the whole window on every fact would wipe
     * a half-typed message and drop the caret with it. */
    if (this.built !== noteId) {
      this.built = noteId;
      this.win.innerHTML = `
        <div class="dm-head">
          ${avatar(ship)}
          <button class="who" title="Their profile">${esc(displayName(ship))}</button>
          <button class="dm-close" title="Back to search">&times;</button>
        </div>
        <div class="dm-body"></div>
        <form class="dm-send"><input placeholder="Message ${esc(displayName(ship))}" autocomplete="off"></form>`;
      this.body = this.win.querySelector('.dm-body');
      /* The cross goes BACK to the search you came through, rather than
       * closing everything and leaving you looking at the world again. */
      this.win.querySelector('.dm-close').onclick = () => {
        this.closeWindow().then(() => { this.panelOpen = true; this.paint(); this.panel.querySelector('input')?.focus(); });
      };
      /* Their name is how you get to who they are -- the same click as
       * everywhere else, rather than a lone "i" beside it. */
      this.win.querySelector('.who').onclick = () => this.onShowProfile(ship);
      const form = this.win.querySelector('form');
      const input = form.querySelector('input');
      form.onsubmit = (e) => {
        e.preventDefault();
        const text = input.value.trim();
        if (!text) return;
        input.value = '';
        postMessage(noteId, text).catch((e2) => console.error('dm send', e2));
      };
      input.focus();
    }

    /* Only follow new messages when already at the bottom -- yanking someone
     * out of the history they are scrolled back through is worse than a
     * missed line. */
    const atBottom =
      this.body.scrollHeight - this.body.scrollTop - this.body.clientHeight < 40;
    const msgs = messagesFor(noteId);
    this.body.innerHTML = msgs.length
      ? msgs.map((m) => `<div class="dm-msg${m.author === our ? ' mine' : ''}">
           <span class="a">${esc(displayName(m.author))}</span>
           <span class="t">${esc(m.text ?? '')}</span></div>`).join('')
      : '<div class="dim pad">nothing yet</div>';

    /* Reading it is what marks it read; the dot has no other way to clear. */
    if (unread(noteId)) markRead(noteId);
    if (atBottom) this.scrollDown();
  }

  scrollDown() {
    requestAnimationFrame(() => { if (this.body) this.body.scrollTop = this.body.scrollHeight; });
  }
}
