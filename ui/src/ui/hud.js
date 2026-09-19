import { chatLines, thread, recentLines } from 'lib/timeline';
import { createPending } from 'lib/pending';
import { our } from 'lib/api';
import { nb, COMMONS_NOTE, RUMORS_NOTE, RUMORS_ROOM, messagesFor, postMessage,
  displayName, watchNotes, setChatHistory, chatHistoryCount, onChange } from 'lib/noltbook';
import { installNote } from 'lib/glurff';
import { roomById, GAME_ROOM } from 'world/places';


export class Hud {
  constructor(root, { events } = {}) {
    this.root = root;
    this.events = events;
    events?.onChange(() => { if (!this.noteFor(this.room)) this.invalidate(); });
    this.room = 0;
    /* Notes we have already asked for this session. Installing REPLACES a note
     * and clears its messages, so this is the belt to the note-list's braces:
     * one request per note, ever, no matter how the state moves under us. */
    this.installed = new Set();
    this.rows = new Map(); this.models = new Map();
    /* Our Commons and Rumors posts, shown before Noltbook confirms them. */
    this.pending = createPending();
    this.profileRevision = 0; this.expanded = false; this.historySize = 100;
    this.build();
    onChange(change => {
      if (change.field === 'profiles') this.profileRevision++;
      this.invalidate();
    }, change => ['notes', 'profiles', 'pals', 'dial'].includes(change.field) ||
      (['messages', 'visibility'].includes(change.field) && change.noteId === this.noteFor(this.room)));
  }

  /* ONLY THE COMMONS IS A NOTE, plus Rumors, which is Noltbook's own anonymous
   * one. Every other room's chat lives in this browser for the session and is
   * never written to Noltbook: a room is a place to talk, not a note. When
   * rooms can be bound to a host's own note, that is what will fill this in. */
  noteFor(room) {
    if (room === 0) return COMMONS_NOTE;
    if (room === RUMORS_ROOM) return RUMORS_NOTE;
    return null;
  }

  async setRoom(room) {
    this.room = room;
    this.historySize = 100;
    this.replyTo = null;
    const note = this.noteFor(room);
    if (note) {
      this.maybeInstall(note, room);
    }
    setChatHistory(this.chatOpen?(this.expanded?this.historySize:3):0);
    const watching=note?watchNotes(note):watchNotes();
    this.paint(); // Cached chat must not wait for a network subscription ACK.
    await watching.catch(() => {});
  }

  /* Materialise a room's note the first time somebody walks in.
   *
   * Only when Noltbook's note list has actually arrived and says it is
   * missing: the receiver REPLACES a note and clears its messages, so asking
   * for one that exists throws away that room's history. Rumors is Noltbook's
   * own note and is never installed. */
  maybeInstall(note, room) {
    if (!note || note === RUMORS_NOTE) return;
    if (!nb.ready || nb.notes[note] || this.installed.has(note)) return;
    this.installed.add(note);
    const install=async()=>{
      if(nb.notes[note])return;
      await installNote(room);
      await new Promise(resolve=>{const timer=setTimeout(()=>{off();resolve();},5000);const off=onChange(()=>{if(nb.notes[note]){clearTimeout(timer);off();resolve();}});});
    };
    const job=navigator.locks?navigator.locks.request('glurff-commons-install',install):install();
    job.catch(()=>{this.root.querySelector('.error').textContent='Could not prepare commons chat. Reload to retry.';});
  }

  /* Threaded replies are Noltbook's, so a reply here is a real reply there --
   * it carries the parent's eid rather than being a new top-level line. */
  setReply(m) {
    this.replyTo = m;
    this.paint();
    if(m)this.setOpen(true);
    if (m) this.root.querySelector('.say input').focus({ preventScroll: true });
  }

  invalidate() {
    if (this.frame != null) return;
    this.frame = requestAnimationFrame(() => { this.frame = null; if (this.chatOpen) this.paint(); });
  }

  lines() {
    const note = this.noteFor(this.room);
    const messages = note ? messagesFor(note) : this.events?.lines() ?? [];
    const old = this.cached;
    if (old && old.messages === messages && old.room === this.room && old.profiles === this.profileRevision &&
        old.pending === this.pending.revision()) return old.lines;
    const flat = note ? chatLines(messages, displayName, note === RUMORS_NOTE) : messages.map(m => ({...m, who: displayName(m.who)}));
    const mine = note ? this.pending.lines(note, messages, { who: note === RUMORS_NOTE ? null : displayName(our) }) : [];
    const lines = thread(mine.length ? [...flat, ...mine] : flat);
    this.cached = {messages, room: this.room, profiles: this.profileRevision, pending: this.pending.revision(), lines};
    return lines;
  }

  build() {
    this.root.innerHTML = `
      <div class="chat">
        <button class="chat-toggle" aria-expanded="true">Close chat</button>
        <div class="chat-content">
        <div class="where"></div>
        <div class="game-controls"><button type="button">Roll 3 dice</button></div>
        <div class="error" role="status"></div>
        <div class="stream"></div>
        <div class="replying"></div>
        <form class="say"><input placeholder="say something" /></form>
        </div>
      </div>`;
    this.chatOpen=true;
    this.setOpen=open=>{this.chatOpen=open;setChatHistory(open?(this.expanded?this.historySize:3):0);this.root.querySelector('.chat-content').hidden=!open;const b=this.root.querySelector('.chat-toggle');b.textContent=open?'Close chat':'Open chat';b.setAttribute('aria-expanded',String(open));if(!open)this.root.querySelector('.say input').blur();else this.paint();};
    this.root.querySelector('.chat-toggle').onclick=()=>this.setOpen(!this.chatOpen);
    this.stream = this.root.querySelector('.stream');
    this.stream.addEventListener('mouseenter', () => {
      this.expanded = true; setChatHistory(this.historySize); this.paint(); this.stream.scrollTop = this.stream.scrollHeight;
    });
    this.stream.addEventListener('mouseleave', () => {
      this.expanded = false; this.historySize = 100; setChatHistory(3); this.paint();
      this.stream.scrollTop = this.stream.scrollHeight;
    });
    this.stream.addEventListener('scroll', () => {
      const note=this.noteFor(this.room);
      if (this.expanded && this.stream.scrollTop < 30 && this.historySize < (note?chatHistoryCount(note):this.lines().length)) {
        this.historySize += 100; setChatHistory(this.historySize); this.paint();
      }
    });
    this.stream.addEventListener('click', e => {
      const el = e.target.closest('.line'); if (!el) return;
      if (e.target.closest('.reply')) { e.stopPropagation(); this.setReply(this.models.get(el.dataset.eid)); }
      else el.classList.toggle('open');
    });
    this.where = this.root.querySelector('.where');
    const form = this.root.querySelector('.say');
    const input = form.querySelector('input');
    input.placeholder = 'Enter to chat';
    input.title = 'Enter to send and walk; Escape to keep your draft and walk';
    window.addEventListener('keydown', (e) => {
      if (e.isComposing || e.keyCode === 229 || e.ctrlKey || e.metaKey || e.altKey || e.shiftKey) return;
      if (document.activeElement === input) {
        if (e.key === 'Escape') {
          e.preventDefault();
          input.blur();
        } else if (e.key === 'Enter') {
          e.preventDefault();
          if (!e.repeat) form.requestSubmit();
        }
        return;
      }
      if (e.key !== 'Enter' || e.repeat || e.defaultPrevented) return;
      const active = document.activeElement;
      // Leave buttons, other editors and open dialogs their normal keyboard controls.
      if (active?.closest('input, textarea, select, button, a, [contenteditable], [role="dialog"]') ||
          document.querySelector('.builder, .card-overlay:not([hidden])')) return;
      e.preventDefault();
      this.setOpen(true);
      input.focus({ preventScroll: true });
    });
    /* Clicking into the chat bar keeps you in it until you click away or press
     * Escape. Getting in with Enter -- or with Reply -- is for one message, and
     * then you are walking again. */
    this.chatSticky = false;
    input.addEventListener('pointerdown', () => { this.chatSticky = true; });
    input.addEventListener('blur', () => { this.chatSticky = false; });
    form.onsubmit = (e) => {
      e.preventDefault();
      if (!this.chatSticky) input.blur();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      const note = this.noteFor(this.room);
      const parent = this.replyTo?.sendEid ?? this.replyTo?.eid ?? null;
      this.replyTo = null;
      /* In the Commons and Rumors the post shows at once, grey until our ship
       * confirms it was sent. Rumors carry no eid, so they match by text. */
      const shown = note === COMMONS_NOTE || note === RUMORS_NOTE
        ? this.pending.add(note, v, parent, messagesFor(note), { byText: note === RUMORS_NOTE }) : null;
      if (shown) this.invalidate();
      const action = note ? postMessage(note,v,parent) : this.events.chat(v,parent);
      this.root.querySelector('.error').textContent='';
      action.then(result => { if (shown) { this.pending.sent(shown, result); this.invalidate(); } }, () => {
        if (shown) { this.pending.failed(shown); this.invalidate(); }
        if(!input.value)input.value = v; this.root.querySelector('.error').textContent = 'Message could not be sent. Try again.';
      });
    };
    this.root.querySelector('.game-controls button').onclick = async (e) => {
      e.target.disabled = true;
      try { await this.events.roll(); } catch { this.root.querySelector('.error').textContent = 'Roll could not be shared. Try again.'; }
      finally { e.target.disabled = false; }
    };
    this.paint();
  }

  paint() {
    if (!this.stream || !this.chatOpen) return;
    const r = this.room === 0 ? {name: 'The Commons'} : roomById(this.room);
    const note = this.noteFor(this.room);
    this.maybeInstall(note, this.room);
    const kind = note === RUMORS_NOTE ? 'anonymous' : note ? 'saved' : 'temporary';
    const label = `${r?.name ?? ''} <span class="dim">${kind}</span>`;
    if (this.label !== label) { this.where.innerHTML = label; this.label = label; }
    this.root.querySelector('.game-controls').hidden = this.room !== GAME_ROOM;
    const all = this.lines();
    const shown = recentLines(all, this.expanded ? this.historySize : 3);
    const recent = new Set(recentLines(all, 3).map(m => m.eid));
    const scroll = this.stream.scrollTop;
    const atBottom = this.stream.scrollHeight - scroll - this.stream.clientHeight < 40;
    const top = this.stream.getBoundingClientRect().top;
    const anchor = this.expanded && !atBottom ? [...this.stream.children].find(el => el.getBoundingClientRect().bottom > top) : null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    const keys = new Set(shown.map(m => m.eid));
    for (const [key, el] of this.rows) if (!keys.has(key)) { el.remove(); this.rows.delete(key); }
    this.models = new Map(shown.map(m => [m.eid, m]));
    let cursor = this.stream.firstChild;
    for (const m of shown) {
      let el = this.rows.get(m.eid);
      if (!el) {
        el = document.createElement('article'); el.className = 'line'; el.dataset.eid = m.eid;
        el.innerHTML = '<header><span class="who"></span><time></time><span class="replies"></span><button class="reply">Reply</button></header><div class="post-text"></div>';
        this.rows.set(m.eid, el);
      }
      const value = [m.who, m.text, m.at, m.depth, m.replies, m.sendEid, recent.has(m.eid), m.pending];
      if (!el.chatValue || value.some((v, i) => v !== el.chatValue[i])) {
        el.classList.toggle('reply-line', Boolean(m.depth));
        el.classList.toggle('recent', recent.has(m.eid)); el.style.setProperty('--depth', m.depth);
        el.classList.toggle('pending', Boolean(m.pending));
        const setText = (selector, text) => { const node = el.querySelector(selector); if (node.textContent !== text) node.textContent = text; };
        setText('.who', String(m.who ?? 'Anonymous'));
        setText('.post-text', String(m.text));
        setText('time', Number.isFinite(m.at) && m.at ? timeFormat.format(new Date(m.at)) : '');
        setText('.replies', m.replies ? `${m.replies} ${m.replies === 1 ? 'reply' : 'replies'}` : '');
        el.querySelector('.reply').hidden = !m.eid || m.sendEid === null;
        el.chatValue = value;
      }
      if (el !== cursor) this.stream.insertBefore(el, cursor);
      cursor = el.nextSibling;
    }
    if (!this.expanded || atBottom) this.stream.scrollTop = this.stream.scrollHeight;
    else if (anchor?.isConnected) this.stream.scrollTop = scroll + anchor.getBoundingClientRect().top - top - anchorOffset;
    else this.stream.scrollTop = scroll;
    const banner = this.root.querySelector('.replying');
    const replyLabel = this.replyTo ? `replying to ${this.replyTo.who ?? 'anon'}` : '';
    if (this.replyLabel !== replyLabel) {
      this.replyLabel = replyLabel; banner.textContent = replyLabel;
      if (this.replyTo) {
        const cancel = document.createElement('button'); cancel.className = 'cancel'; cancel.textContent = 'x';
        cancel.onclick = () => this.setReply(null); banner.append(' ', cancel);
      }
    }
  }
}

const timeFormat = new Intl.DateTimeFormat([], {hour: '2-digit', minute: '2-digit'});
