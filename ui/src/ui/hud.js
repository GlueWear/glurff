import { chatLines, thread, recentLines, messageKey, isCallControl } from 'lib/timeline';
import { createPending, canRetry } from 'lib/pending';
import { createChatUnread } from 'lib/chat-unread';
import { our } from 'lib/api';
import { nb, COMMONS_NOTE, RUMORS_NOTE, RUMORS_ROOM, messagesFor, postMessage,
  displayName, noteName, noteUrl, watchNotes, setChatHistory, chatHistoryCount,
  hasEarlierMessages, loadEarlierMessages, onChange, editMessage, deleteMessage } from 'lib/noltbook';
import { messageActions, openMenu, closeMenu, paintText, aboutLine, paintSendState } from 'ui/messages';
import { ask } from 'ui/ask';
import { roomById, GAME_ROOM } from 'world/places';
import { leaseNote, onRooms, onRoommates } from 'lib/rooms';
import { esc } from 'ui/html';


export class Hud {
  constructor(root, { events, secret, send } = {}) {
    this.root = root;
    this.events = events;
    /* (ship, at): a message's SEND -- the send box, and the payment message
     * at `at` (lib/wallet postReceipt). */
    this.send = send ?? (() => {});
    /* The line being edited, its words back in the box; see ui/messages. */
    this.editing = null;
    /* (text, room) => true when what was typed is not a message at all (the
     * Library's secret; see lib/unlock), and so is not sent. */
    this.secret = secret ?? (() => false);
    this.unread = createChatUnread(our);
    events?.onChange(message => {
      if (this.noteFor(this.room)) return;
      if (message) this.unread.receive(message.eid, message.who);
      this.invalidate();
    });
    this.room = 0;
    this.rows = new Map(); this.models = new Map();
    /* Our Commons and Rumors posts, shown before Noltbook confirms them. */
    this.pending = createPending();
    this.profileRevision = 0; this.historySize = CHAT_LINES;
    /* The note this room's chat is currently bound to, so we can notice it
     * changing under us; see retune. */
    this.boundNote = null;
    this.build();
    /* A ROOM'S NOTE CAN CHANGE WITHOUT ANYBODY WALKING ANYWHERE.
     *
     * Somebody leases the room we are standing in, or gives it back, and the
     * chat under us stops being one thing and becomes another. Only `setRoom`
     * bound the chat, and only walking through a door calls it -- so a guest
     * kept talking into a note that had been released until they left the room
     * and came back. A lease is a ROSTER change, which is why watching
     * Noltbook's notes was not enough to hear it. */
    onRooms(() => this.retune());
    onRoommates(() => this.retune());
    onChange(change => {
      if (change.message && !isCallControl(change.message.text))
        this.unread.receive(messageKey(change.message), change.message.author);
      if (change.field === 'profiles') this.profileRevision++;
      if (change.field === 'world' && nb.world.joined && this.room === 0)
        watchNotes(COMMONS_NOTE).catch(() => {});
      this.invalidate();
    }, change => ['world', 'notes', 'profiles', 'pals', 'dial'].includes(change.field) ||
      (['messages', 'visibility'].includes(change.field) && change.noteId === this.noteFor(this.room)));
  }

  /* WHICH NOTE THIS ROOM'S CHAT IS, if any.
   *
   * The commons is a note, and so is Rumors, which is Noltbook's own anonymous
   * one. Every other room's chat lives in this browser for the session and is
   * never written to Noltbook -- UNLESS somebody has leased it to one of their
   * own notes, in which case the chat is that note's chat, saved, with its
     * history and its rules. The room label says plainly whether chat is saved. */
  noteFor(room) {
    if (room === 0) return COMMONS_NOTE;
    if (room === RUMORS_ROOM) return RUMORS_NOTE;
    return leaseNote(room) ?? null;
  }

  async setRoom(room) {
    this.unread.reset();
    this.room = room;
    this.historySize = CHAT_LINES;
    this.replyTo = null; this.editing = null; closeMenu();
    const note = this.noteFor(room);
    this.boundNote = note;
    setChatHistory(this.chatOpen ? this.historySize : 0);
    const watching=note && (note!==COMMONS_NOTE || nb.world.joined)?watchNotes(note):watchNotes();
    this.paint(); // Cached chat must not wait for a network subscription ACK.
    await watching.catch(() => {});
  }

  /* The room stayed the same; what it is SAVED TO did not. Rebind to the note
   * the room is now, or back to the chat this browser keeps for it. Deliberately
   * not `setRoom`: nobody has moved, so the reply being written and how far the
   * history is unrolled are left alone. */
  retune() {
    const note = this.noteFor(this.room);
    if (note === this.boundNote) return;
    this.unread.reset();
    this.boundNote = note;
    this.replyTo = null; this.editing = null; closeMenu();
    (note && (note!==COMMONS_NOTE || nb.world.joined) ? watchNotes(note) : watchNotes()).catch(() => {});
    this.invalidate();
  }

  /* Threaded replies are Noltbook's, so a reply here is a real reply there --
   * it carries the parent's eid rather than being a new top-level line. */
  setReply(m) {
    this.replyTo = m; if (m) this.editing = null;
    this.paint();
    if(m)this.setOpen(true);
    if (m) this.root.querySelector('.say input').focus({ preventScroll: true });
  }

  /* What may be done in this chat (ui/messages messageActions). */
  context() {
    const note = this.noteFor(this.room);
    return { our, note: note ? nb.notes[note] ?? null : null, anonymous: note === RUMORS_NOTE };
  }

  async act(act, line) {
    const note = this.noteFor(this.room);
    if (act === 'reply') this.setReply(line);
    else if (act === 'edit') {
      this.replyTo = null; this.editing = line;
      const input = this.root.querySelector('.say input');
      input.value = line.text; this.chatSticky = true;
      this.setOpen(true); input.focus({ preventScroll: true });
    } else if (act === 'send') {
      /* The payment message goes where the send was made: a saved chat as a
       * reply to the message, a session chat as one of its lines. */
      this.send(line.author, note ? { noteId: note, replyToEid: line.replyId }
        : { room: (text) => this.events.chat(text, line.eid) });
    } else if (act === 'delete') {
      if (!(await ask('Delete this message?', { yes: 'Delete' }))) return;
      (note ? deleteMessage(note, line.replyId) : this.events.remove(line.eid)).catch(() => {
        this.root.querySelector('.error').textContent = 'That could not be deleted. Try again.';
      });
    }
  }

  invalidate() {
    if (this.frame != null) return;
    /* THE ROOM LABEL IS NOT CHAT CONTENT. It says where you are and whether
     * what is said here is saved, and it has to be right whether or not the
     * chat is open -- which, since chat starts closed, was most of the time.
     * `paint` stops before the stream itself when the chat is shut. */
    this.frame = requestAnimationFrame(() => { this.frame = null; this.paint(); });
  }

  lines() {
    const note = this.noteFor(this.room);
    const messages = note ? messagesFor(note) : this.events?.lines() ?? [];
    const old = this.cached;
    if (old && old.messages === messages && old.room === this.room && old.profiles === this.profileRevision &&
        old.pending === this.pending.revision()) return old.lines;
    const flat = note ? chatLines(messages, displayName, note === RUMORS_NOTE)
      : messages.map(m => ({...m, who: displayName(m.who), author: m.who, replyId: m.eid}));
    const mine = note ? this.pending.lines(note, messages, { who: note === RUMORS_NOTE ? null : displayName(our) }) : [];
    const lines = thread(mine.length ? [...flat, ...mine] : flat);
    this.cached = {messages, room: this.room, profiles: this.profileRevision, pending: this.pending.revision(), lines};
    return lines;
  }

  build() {
    this.root.innerHTML = `
      <div class="chat">
        <div class="chat-peek" aria-hidden="true"></div>
        <button class="chat-toggle" aria-expanded="false">${CHAT_ICON}<span class="chat-toggle-label">Open chat</span><span class="chat-unread" hidden></span></button>
        <div class="chat-content" hidden>
        <div class="where"></div>
        <div class="game-controls"><button type="button">Roll 3 dice</button></div>
        <div class="error" role="status"></div>
        <div class="rumors-note" hidden><strong>Rumors</strong> No name is on anything said here. It goes from pal to pal:
          you hear what your pals pass on, and they pass on what you say. With no pals, nobody hears you and nothing
          reaches you; add pals from their profile cards.</div>
        <div class="stream"></div>
        <div class="replying"></div>
        <form class="say"><input placeholder="say something" enterkeyhint="send" /></form>
        </div>
      </div>`;
    this.chatOpen=false;
    setChatHistory(0);
    /* ON A PHONE there is no hovering over the chat to see more of it: open is
     * all of it, in a panel that scrolls. html.chat-open lets the layout make
     * room for it; see style.css. */
    /* OPEN IS OPEN (2026-10-13): the last CHAT_LINES messages, the same size
     * whatever the pointer does -- nothing grows on hover and shrinks when the
     * pointer heads for a line's menu. Older ones are a scroll up. */
    this.setOpen=open=>{this.chatOpen=open;if(open)this.historySize=CHAT_LINES;if(touchy())this.root.querySelector('.say input').placeholder='Say something';
      document.documentElement.classList.toggle('chat-open',open);this.unread.open(open);setChatHistory(open?this.historySize:0);this.root.querySelector('.chat-content').hidden=!open;const b=this.root.querySelector('.chat-toggle');b.querySelector('.chat-toggle-label').textContent=open?'Close chat':'Open chat';b.setAttribute('aria-expanded',String(open));if(!open)this.root.querySelector('.say input').blur();this.paint();};
    this.root.querySelector('.chat-toggle').onclick=()=>this.setOpen(!this.chatOpen);
    /* A line seen in passing is a way in: click it and the chat opens. */
    this.peek = this.root.querySelector('.chat-peek');
    this.peek.onclick = () => this.setOpen(true);
    this.stream = this.root.querySelector('.stream');
    /* OLDER MESSAGES: scrolled to the top -- or, while everything still fits,
     * a wheel turned up there -- brings fifty more. */
    const older = () => {
      const note=this.noteFor(this.room);
      const available=note?chatHistoryCount(note):this.lines().length;
      if (this.historySize < available) {
        this.historySize = Math.min(500, this.historySize + 50);
        setChatHistory(this.historySize); this.paint();
      }
      if (note && this.historySize >= available && hasEarlierMessages(note))
        loadEarlierMessages(note).catch(error => console.warn('Could not load earlier chat:', error.message));
    };
    /* Only a scroll UP: the chat keeping itself at the newest message scrolls
     * too, and that is no request for more. */
    let lastTop = 0;
    this.stream.addEventListener('scroll', () => {
      const top = this.stream.scrollTop, up = top < lastTop; lastTop = top;
      if (up && top < 30) older();
    });
    this.stream.addEventListener('wheel', (e) => { if (e.deltaY < 0 && this.stream.scrollTop === 0) older(); }, { passive: true });
    /* A click on a line opens what may be done with it, where it was
     * clicked (ui/messages); nothing for Rumors, which is nobody's. */
    this.stream.addEventListener('click', e => {
      /* A post that did not go: again, or away. */
      const again = e.target.closest('.send-retry'), away = e.target.closest('.send-drop');
      if (again || away) { const id = e.target.closest('.line')?.dataset.eid; if (id) again ? this.retrySend(id) : this.dropSend(id); return; }
      const el = e.target.closest('.line'); if (!el || !aboutLine(e)) return;
      const line = this.models.get(el.dataset.eid);
      const actions = messageActions(line, this.context());
      if (actions.length) openMenu(e.clientX, e.clientY, actions, act => this.act(act, line));
    });
    /* The menu goes when WE scroll the chat, not when it moves under us --
     * a new message keeping it at the bottom closed it before a choice. */
    this.stream.addEventListener('wheel', closeMenu, { passive: true });
    this.stream.addEventListener('touchmove', closeMenu, { passive: true });
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
          if (this.editing) { this.editing = null; input.value = ''; this.paint(); }
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
      /* AN EDIT: the same line, new words. */
      if (this.editing) {
        const target = this.editing, note = this.noteFor(this.room);
        this.editing = null; this.paint();
        if (v === target.text) return;
        (note ? editMessage(note, target.replyId, v) : this.events.edit(target.eid, v)).catch(() => {
          this.root.querySelector('.error').textContent = 'That could not be edited. Try again.';
        });
        return;
      }
      if (this.secret(v, this.room)) return;
      const note = this.noteFor(this.room);
      const parent = this.replyTo?.sendEid ?? this.replyTo?.eid ?? null;
      this.replyTo = null;
      this.root.querySelector('.error').textContent='';
      if (note) { this.sendToNote(note, v, parent); return; }
      this.events.chat(v,parent).catch(() => {
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
    if (!this.stream) return;
    const badge = this.root.querySelector('.chat-unread');
    if (badge) {
      const count = this.unread.count();
      badge.hidden = !count;
      badge.textContent = String(count);
      this.root.querySelector('.chat-toggle').setAttribute('aria-label', this.chatOpen ? 'Close chat' : `Open chat${count ? `, ${count} unread messages` : ''}`);
    }
    const r = this.room === 0 ? {name: 'The Commons'} : roomById(this.room);
    const note = this.noteFor(this.room);
    const leased = this.room !== 0 && note !== RUMORS_NOTE && !!note;
    const title = leased ? noteName(note) ?? r?.name ?? '' : r?.name ?? '';
    const kind = note === RUMORS_NOTE ? 'anonymous'
      : leased ? 'chat saved to noltbook'
      : note ? 'saved' : 'chat is not saved';
    /* The title can be a note's name, which its creator chose: escaped. */
    const saved = this.room === 0
      ? `<a class="dim" href="${esc(noteUrl(COMMONS_NOTE))}" target="_blank" rel="noopener noreferrer">saved in Noltbook ↗</a>`
      : `<span class="dim">${esc(kind)}</span>`;
    const label = `${esc(title)} ${saved}`;
    if (this.label !== label) { this.where.innerHTML = label; this.label = label; }
    this.root.querySelector('.game-controls').hidden = this.room !== GAME_ROOM;
    this.root.querySelector('.rumors-note').hidden = note !== RUMORS_NOTE;
    this.paintPeek();
    if (!this.chatOpen) return;
    const all = this.lines();
    const shown = recentLines(all, this.historySize);
    const recent = new Set(shown.map(m => m.eid));
    const scroll = this.stream.scrollTop;
    const atBottom = this.stream.scrollHeight - scroll - this.stream.clientHeight < 40;
    const top = this.stream.getBoundingClientRect().top;
    const anchor = !atBottom ? [...this.stream.children].find(el => el.getBoundingClientRect().bottom > top) : null;
    const anchorOffset = anchor ? anchor.getBoundingClientRect().top - top : 0;
    const keys = new Set(shown.map(m => m.eid));
    for (const [key, el] of this.rows) if (!keys.has(key)) { el.remove(); this.rows.delete(key); }
    this.models = new Map(shown.map(m => [m.eid, m]));
    let cursor = this.stream.firstChild;
    for (const m of shown) {
      let el = this.rows.get(m.eid);
      if (!el) {
        el = document.createElement('article'); el.className = 'line'; el.dataset.eid = m.eid;
        el.innerHTML = '<header><span class="who"></span><time></time><span class="replies"></span><span class="send-state"></span></header><div class="post-text"></div>';
        this.rows.set(m.eid, el);
      }
      const value = [m.who, m.text, m.at, m.depth, m.replies, m.sendEid, recent.has(m.eid), m.pending, m.edited, m.author, this.profileRevision, m.state, m.awaiting];
      if (!el.chatValue || value.some((v, i) => v !== el.chatValue[i])) {
        el.classList.toggle('reply-line', Boolean(m.depth));
        el.classList.toggle('recent', recent.has(m.eid)); el.style.setProperty('--depth', m.depth);
        el.classList.toggle('pending', Boolean(m.pending));
        paintSendState(el, m.state, m.awaiting);
        const setText = (selector, text) => { const node = el.querySelector(selector); if (node.textContent !== text) node.textContent = text; };
        setText('.who', String(m.who ?? 'Anonymous'));
        /* Rumors is anonymous, so it stays letters for letters; see ui/media. */
        const said = el.querySelector('.post-text');
        paintText(said, m.text, { our, name: displayName, embed: this.noteFor(this.room) !== RUMORS_NOTE });
        if (m.edited) { const ed = document.createElement('span'); ed.className = 'edited'; ed.textContent = '(edited)'; said.append(' ', ed); }
        el.classList.toggle('mine', !!m.author && m.author === our);
        el.classList.toggle('actionable', messageActions(m, this.context()).length > 0);
        setText('time', Number.isFinite(m.at) && m.at ? timeFormat.format(new Date(m.at)) : '');
        setText('.replies', m.replies ? `${m.replies} ${m.replies === 1 ? 'reply' : 'replies'}` : '');
        el.chatValue = value;
      }
      if (el !== cursor) this.stream.insertBefore(el, cursor);
      cursor = el.nextSibling;
    }
    if (atBottom) this.stream.scrollTop = this.stream.scrollHeight;
    else if (anchor?.isConnected) this.stream.scrollTop = scroll + anchor.getBoundingClientRect().top - top - anchorOffset;
    else this.stream.scrollTop = scroll;
    const banner = this.root.querySelector('.replying');
    const replyLabel = this.editing ? 'editing your message' : this.replyTo ? `replying to ${this.replyTo.who ?? 'anon'}` : '';
    if (this.replyLabel !== replyLabel) {
      this.replyLabel = replyLabel; banner.textContent = replyLabel;
      if (this.editing || this.replyTo) {
        const cancel = document.createElement('button'); cancel.className = 'cancel'; cancel.textContent = '×';
        cancel.title = this.editing ? 'Stop editing' : 'Stop replying';
        cancel.onclick = () => {
          if (this.editing) { this.editing = null; this.root.querySelector('.say input').value = ''; this.paint(); }
          else this.setReply(null);
        };
        banner.append(' ', cancel);
      }
    }
  }

  /* A POST TO A NOTE (2026-10-22): on screen at once, and kept there however
   * it goes -- grey, amber if our ship is slow to confirm it (or, in a note
   * another ship hosts, slow to come back), red with Retry if it was refused.
   * See lib/pending. Room chats with no note go over the relay as before. */
  sendToNote(note, text, parent) {
    const shown = this.pending.add(note, text, parent, messagesFor(note), { byText: note === RUMORS_NOTE, author: our });
    this.changedSends();
    postMessage(note, text, parent).then((result) => { this.pending.sent(shown, result); this.changedSends(); },
      (error) => { if (error?.result) this.pending.refused(shown); else this.pending.unconfirmed(shown); this.changedSends(); });
  }
  /* Only a post that was not stored is offered again: see lib/pending. */
  retrySend(id) {
    const p = this.pending.get(id);
    if (!p || !canRetry(this.pending.lines(p.note, messagesFor(p.note)).find((l) => l.eid === id)?.state)) return;
    this.pending.drop(id);
    this.sendToNote(p.note, p.text, p.parent);
  }
  dropSend(id) { this.pending.drop(id); this.changedSends(); }
  /* Repaint now, and again when a line's state next moves on by itself. */
  changedSends() {
    this.invalidate();
    clearTimeout(this.sendTimer);
    const ms = this.pending.wakeIn();
    if (ms != null) this.sendTimer = setTimeout(() => { this.pending.tick(); this.changedSends(); }, ms + 30);
  }

  /* The glance: see PEEK_MS. Rebuilt only when the newest line changes. */
  paintPeek() {
    if (!this.peek) return;
    if (this.chatOpen) { this.peek.classList.remove('fresh'); return; }
    const lines = this.lines(), last = lines.at(-1), newest = last?.eid ?? null, room = this.room;
    const changed = newest !== this.peekNewest || room !== this.peekRoom;
    this.peekNewest = newest; this.peekRoom = room;
    if (!changed) return;
    this.peek.textContent = '';
    for (const m of lines.slice(-PEEK_LINES)) {
      const row = document.createElement('div');
      row.className = 'peek-line';
      const who = document.createElement('b');
      who.textContent = String(m.who ?? 'Anonymous');
      const said = document.createElement('span');
      paintText(said, m.text, { our, name: displayName, embed: false });
      row.append(who, ' ', said);
      this.peek.appendChild(row);
    }
    clearTimeout(this.peekTimer);
    /* Just said -- or ours, not yet stamped. History arriving after us is
     * older than PEEK_RECENT_MS, and stays out of the way. */
    const recent = last && (!Number.isFinite(last.at) || Date.now() - last.at < PEEK_RECENT_MS);
    if (!recent) { this.peek.classList.remove('fresh'); return; }
    this.peek.classList.add('fresh');
    this.peekTimer = setTimeout(() => this.peek.classList.remove('fresh'), PEEK_MS);
  }
}

/* How many messages an open chat shows, before scrolling up for more. */
export const CHAT_LINES = 7;
/* CHAT AT A GLANCE (2026-10-21): with the chat shut, what was just said shows
 * faintly above its button -- the newest PEEK_LINES lines, for PEEK_MS after
 * the newest arrived -- so a conversation is noticed as it happens. Only what
 * was said in the last PEEK_RECENT_MS: older history is not replayed. */
export const PEEK_LINES = 3, PEEK_MS = 9000, PEEK_RECENT_MS = 120000;
const CHAT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

/* Played by touch: see ui/touch-controls. */
const touchy = () => typeof document !== 'undefined' && document.documentElement.classList.contains('touch');

const timeFormat = new Intl.DateTimeFormat([], {hour: '2-digit', minute: '2-digit'});
