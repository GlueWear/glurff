import { chatLines, thread, recentLines, messageKey, isCallControl } from 'lib/timeline';
import { createPending, canRetry } from 'lib/pending';
import { createChatUnread } from 'lib/chat-unread';
import { our } from 'lib/api';
import { nb, COMMONS_NOTE, RUMORS_NOTE, RUMORS_ROOM, messagesFor, postMessage,
  displayName, noteName, noteUrl, watchNotes, setChatHistory, chatHistoryCount,
  hasEarlierMessages, loadEarlierMessages, onChange, editMessage, deleteMessage, glurffMuted } from 'lib/noltbook';
import { messageActions, openMenu, closeMenu, paintText, aboutLine, paintSendState } from 'ui/messages';
import { ask } from 'ui/ask';
import { roomById, chatAt, placeName } from 'world/places';
import { parseRoll, rollDice, rollText } from 'lib/dice';
import { parsePoll, resultText } from 'lib/polls';
import { leaseNote, onRooms, onRoommates, chatBar } from 'lib/rooms';
import { esc } from 'ui/html';

/* Why this room's chat will not take what we say (lib/rooms chatBar). */
const CALL_BAR = { muted: 'You are muted in this room’s call,', removed: 'You were removed from this room’s call,' };

export class Hud {
  /* preview: a playtest's chat, which shows what is said and sends nothing --
   * only a phrase that does something here works (2026-11-06). */
  constructor(root, { events, secret, send, polls = null, name = (s) => s, preview = false, scene = () => undefined } = {}) {
    this.preview = preview;
    /* POLLS in the chat we are in (lib/polls), and who started them. */
    this.polls = polls; this.nameOf = name;
    polls?.onChange((poll) => {
      if (poll && poll.place === this.room && poll.by !== our && !this.chatOpen) this.unread.receive(`poll:${poll.id}`, poll.by);
      this.paintPolls(); this.invalidate();
    });
    this.scene = scene;
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
    /* Walking out of a chat ends our polls in it. */
    for (const p of this.polls?.mine() ?? []) if (p.place !== room) this.endPoll(p.id, { leaving: true });
    this.room = room;
    this.paintPolls();
    /* Somewhere with no chat -- the quiet floor between areas, a quiet area. */
    const say = this.root.querySelector('.say input');
    if (say) { say.disabled = !chatAt(room); say.placeholder = say.disabled ? 'No chat here' : this.preview ? 'Try a phrase (nothing is sent)' : 'say something'; }
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
        <button class="chat-toggle" aria-expanded="false">${CHAT_ICON}<span class="chat-toggle-label">Open chat</span><span class="chat-unread" hidden></span></button>
        <div class="chat-content" hidden>
        <div class="where"></div>
        <div class="error" role="status"></div>
        <div class="rumors-note" hidden><strong>Rumors</strong> No name is on anything said here. It goes from pal to pal:
          you hear what your pals pass on, and they pass on what you say. With no pals, nobody hears you and nothing
          reaches you; add pals from their profile cards.</div>
        <div class="polls"></div>
        <div class="stream"></div>
        <div class="replying"></div>
        <div class="commands" hidden></div>
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
    /* On the stage (ui/stage), opening the chat puts you in its box, as
     * though you had clicked into it: the keyboard is the chat's until
     * Escape or closing it gives it back to what is staged. */
    this.root.querySelector('.chat-toggle').onclick=()=>{this.setOpen(!this.chatOpen);
      if(this.chatOpen&&staged()){this.chatSticky=true;this.root.querySelector('.say input').focus({preventScroll:true});}};
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
    /* MUTED IN THE GLURFF (2026-10-31): reading, yes; saying, no -- anywhere
     * in it. What was typed stays in the box. A word that is not sent at all
     * (the Library's, the Game Room's) still works. */
    const gagged = (v) => {
      if (!glurffMuted(our)) return false;
      if (!input.value) input.value = v;
      this.root.querySelector('.error').textContent = 'You are muted in this Glurff, so you cannot send messages.';
      return true;
    };
    /* MUTED OR REMOVED IN THIS ROOM'S CALL (2026-11-01): the same, in a room
     * whose chat is its own (lib/rooms chatBar). */
    const hushed = (v) => {
      const bar = chatBar(our, this.room);
      if (!bar) return false;
      if (!input.value) input.value = v;
      this.root.querySelector('.error').textContent = CALL_BAR[bar] + ' so you cannot post in its chat.';
      return true;
    };
    form.onsubmit = (e) => {
      e.preventDefault();
      /* On the stage you stay in the chat after a send (ui/stage). */
      if (!this.chatSticky && !staged()) input.blur();
      const v = input.value.trim();
      if (!v) return;
      input.value = '';
      const roll = !this.editing && parseRoll(v), poll = !this.editing && parsePoll(v);
      const error = this.root.querySelector('.error');
      /* A command that will not do stays in the box, saying why. */
      if (roll?.error || poll?.error) { input.value = v; error.textContent = roll?.error ?? poll.error; return; }
      if (this.preview) {
        if (roll) error.textContent = `${rollText(roll, rollDice(roll))} (nothing is sent in a playtest)`;
        else if (poll) this.startPoll(poll);
        else if (!this.secret(v, this.room)) error.textContent = 'Nothing said in a playtest is sent.';
        return;
      }
      /* AN EDIT: the same line, new words. */
      if (this.editing) {
        const target = this.editing, note = this.noteFor(this.room);
        this.editing = null; this.paint();
        if (v === target.text || gagged(v) || (!note && hushed(v))) return;
        (note ? editMessage(note, target.replyId, v) : this.events.edit(target.eid, v)).catch(() => {
          this.root.querySelector('.error').textContent = 'That could not be edited. Try again.';
        });
        return;
      }
      if (this.secret(v, this.room)) return;
      if (gagged(v)) return;
      const note = this.noteFor(this.room);
      if (!note && hushed(v)) return;
      const parent = this.replyTo?.sendEid ?? this.replyTo?.eid ?? null;
      this.replyTo = null;
      this.root.querySelector('.error').textContent='';
      /* /ROLL (2026-11-08): our own app rolls, and the chat says what came
       * up -- a line of text in a saved chat, a roll in a session one. */
      if (roll) {
        const dice = rollDice(roll);
        if (note) this.sendToNote(note, rollText(roll, dice), parent);
        else this.events.roll(roll, dice, parent).catch(() => { this.root.querySelector('.error').textContent = 'The roll could not be shared. Try again.'; });
        return;
      }
      if (poll) { this.startPoll(poll); return; }
      if (note) { this.sendToNote(note, v, parent); return; }
      this.events.chat(v,parent).catch(() => {
        if(!input.value)input.value = v; this.root.querySelector('.error').textContent = 'Message could not be sent. Try again.';
      });
    };
    /* THE COMMANDS (2026-11-08): typing "/" shows what there is. */
    const commands = this.root.querySelector('.commands');
    const hint = () => {
      const word = input.value.startsWith('/') ? input.value.split(/\s/)[0].toLowerCase() : null;
      const shown = word == null ? [] : COMMANDS.filter((c) => c.name.startsWith(word) || word === c.name);
      commands.hidden = !shown.length || (input.value.includes(' ') && !shown.some((c) => c.name === word));
      commands.innerHTML = shown.map((c) => `<button type="button" data-fill="${esc(c.fill)}"><strong>${esc(c.name)}</strong> <span class="dim">${esc(c.about)}</span></button>`).join('');
    };
    input.addEventListener('input', hint);
    input.addEventListener('blur', () => setTimeout(() => { commands.hidden = true; }, 150));
    commands.addEventListener('pointerdown', (e) => e.preventDefault());
    commands.addEventListener('click', (e) => {
      const b = e.target.closest('button[data-fill]'); if (!b) return;
      input.value = b.dataset.fill; input.focus({ preventScroll: true }); hint();
    });
    /* A poll's choices, and its creator's End. */
    this.root.querySelector('.polls').addEventListener('click', (e) => {
      const b = e.target.closest('button'); if (!b || b.disabled) return;
      const card = b.closest('.poll'); if (!card) return;
      if (b.dataset.choice != null) {
        if (glurffMuted(our)) { this.root.querySelector('.error').textContent = 'You are muted in this Glurff, so you cannot vote.'; return; }
        this.polls?.vote(card.dataset.id, Number(b.dataset.choice));
      }
      if (b.matches('.poll-end')) this.endPoll(card.dataset.id);
    });
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
    const r = { name: placeName(this.room, this.scene()) };
    const note = this.noteFor(this.room);
    const leased = this.room !== 0 && note !== RUMORS_NOTE && !!note;
    const title = leased ? noteName(note) ?? r?.name ?? '' : r?.name ?? '';
    const kind = !chatAt(this.room) ? 'no chat here' : note === RUMORS_NOTE ? 'anonymous'
      : leased ? 'chat saved to noltbook'
      : note ? 'saved' : 'chat is not saved';
    /* The title can be a note's name, which its creator chose: escaped. */
    const saved = this.room === 0
      ? `<a class="dim" href="${esc(noteUrl(COMMONS_NOTE))}" target="_blank" rel="noopener noreferrer">saved in Noltbook ↗</a>`
      : `<span class="dim">${esc(kind)}</span>`;
    const label = `${esc(title)} ${saved}`;
    if (this.label !== label) { this.where.innerHTML = label; this.label = label; }
    this.root.querySelector('.rumors-note').hidden = note !== RUMORS_NOTE;
    /* CLOSED IS CLOSED (2026-10-31): no line of anybody's shows while the chat
     * is shut -- not one just arrived, not one of ours still sending, not a
     * page of history landing late. The button and its unread count say there
     * is something to read. */
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

  /* /POLL (2026-11-08): one of ours in this chat, which our app keeps. */
  startPoll(poll) {
    const error = this.root.querySelector('.error');
    if (!this.polls) return;
    try { this.polls.start(this.room, poll); error.textContent = ''; this.setOpen(true); }
    catch (e) { error.textContent = e.message; }
  }
  /* Ending one of ours: everybody told, and the result a line of its chat
   * -- saved, where the chat is; a session chat's only while we are in it. */
  endPoll(id, { leaving = false } = {}) {
    const p = this.polls?.end(id);
    if (p) this.postResult(p, { leaving });
  }
  postResult(p, { leaving = false } = {}) {
    if (this.preview) return;
    const note = this.noteFor(p.place);
    if (note) this.sendToNote(note, resultText(p), null);
    else if (!leaving && p.place === this.room) this.events.chat(resultText(p)).catch(() => {});
  }
  paintPolls() {
    const box = this.root.querySelector('.polls'); if (!box) return;
    const polls = this.polls?.in(this.room) ?? [];
    const html = polls.map((p) => {
      const total = p.counts.reduce((a, b) => a + b, 0);
      const who = p.by === our ? 'your poll' : `poll by ${this.nameOf(p.by)}`;
      return `<div class="poll${p.open ? '' : ' ended'}" data-id="${esc(p.id)}">
        <div class="poll-q"><span>📊 ${esc(p.question)}</span><span class="dim">${esc(who)}${p.open ? '' : ' · ended'}</span></div>
        <div class="poll-options">${p.options.map((o, i) => `<button type="button" data-choice="${i}"${p.open ? '' : ' disabled'}
          class="${p.mine === i ? 'on' : ''}" style="--share:${total ? Math.round(p.counts[i] / total * 100) : 0}%"><span>${esc(o)}</span><b>${p.counts[i]}</b></button>`).join('')}</div>
        ${p.open && p.by === our ? '<button type="button" class="poll-end">End poll</button>' : ''}</div>`;
    }).join('');
    if (box.dataset.html !== html) { box.innerHTML = html; box.dataset.html = html; }
    box.hidden = !polls.length;
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
}

/* How many messages an open chat shows, before scrolling up for more. */
export const CHAT_LINES = 7;
const CHAT_ICON = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M21 12a8 8 0 0 1-11.6 7.1L4 20l1-4.6A8 8 0 1 1 21 12z"/></svg>';

/* Played by touch: see ui/touch-controls. */
const touchy = () => typeof document !== 'undefined' && document.documentElement.classList.contains('touch');
/* Something showing on the stage (ui/stage): an app, a website, a video, the editor. */
const staged = () => typeof document !== 'undefined' && document.documentElement.classList.contains('staged');

const timeFormat = new Intl.DateTimeFormat([], {hour: '2-digit', minute: '2-digit'});

/* What "/" offers (2026-11-08). */
const COMMANDS = [
  { name: '/roll', fill: '/roll ', about: 'roll dice: /roll, /roll 2d20, /roll d100+3' },
  { name: '/poll', fill: '/poll ', about: 'a poll: /poll Pizza or tacos? | Pizza | Tacos' },
];
