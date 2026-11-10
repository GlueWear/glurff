/* WHAT A PLACED THING SHOWS (2026-11-05): an item of the world's document
 * whose behaviour is to show something rather than open an app or a site --
 * some text, a list of links, a Noltbook artifact -- in a card over the
 * world, in Glurff's own voice. Nothing in it runs in Glurff's page: text is
 * text, links leave in a new tab, and an artifact is shown by our own
 * Noltbook (which applies the artifact's own permissions) in a frame
 * sandboxed to nothing, so a file can never act as us. */
import { esc } from 'ui/html';
import { noteUrl } from 'lib/noltbook';
import { NOTE_REF, noteName } from 'lib/note-link';
import { editableSign, SIGN_MAX } from 'lib/signs';

let open = null;
export function closeContent() { open?.(); }

/* Addresses in text are links, opening in a new tab; a note's link (a
 * Glurff's invite link among them) is its name, taken as in a chat. */
const textHtml = (text) => `<div class="content-text">${esc(text)
  .replace(/https:\/\/[^\s<]+/g, (u) => `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>`)
  .replace(new RegExp(NOTE_REF.source, 'g'), (m, note, host, name) =>
    `<button type="button" class="note-ref" data-note="${note}" data-host="${host}">${esc(noteName(name)) || 'Note link'}</button>`)}</div>`;
const ago = (ms) => {
  const m = Math.round((Date.now() - ms) / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m} minute${m === 1 ? '' : 's'} ago`;
  if (m < 1440) { const h = Math.round(m / 60); return `${h} hour${h === 1 ? '' : 's'} ago`; }
  return new Date(ms).toLocaleDateString();
};

/* signs: lib/signs, for a sign people can write on. name(ship): who they
 * are. isHost: we host this world, and may put a sign back. */
export function showContent(item, { signs = null, name = (s) => s, isHost = false } = {}) {
  closeContent();
  const d = item.do ?? {};
  if (d.kind === 'text' && signs && editableSign(item)) return showSign(item, { signs, name, isHost });
  const root = document.createElement('div');
  root.className = 'ask-overlay content-overlay';
  const safe = (url) => (/^https:\/\//.test(url) ? url : null);
  let body = '';
  if (d.kind === 'text') body = textHtml(d.text ?? '');
  if (d.kind === 'links') body = `<ul class="content-links">${(d.links ?? []).filter((l) => safe(l.url)).map((l) =>
    `<li><a href="${esc(l.url)}" target="_blank" rel="noopener noreferrer">${esc(l.title)}</a><span class="dim"> ${esc(new URL(l.url).host)}</span></li>`).join('')}</ul>`;
  if (d.kind === 'artifact') body = `<iframe class="content-artifact" sandbox="" referrerpolicy="no-referrer" title="${esc(item.name)}"
      src="/apps/noltbook/artifact/${encodeURIComponent(d.artifact)}"></iframe>
    <a class="dim" href="${esc(noteUrl(d.note))}" target="_blank" rel="noopener">Open its note in Noltbook</a>`;
  root.innerHTML = `<div class="ask content-card" role="dialog" aria-modal="true" aria-label="${esc(item.name)}">
    <div class="ask-q">${esc(item.name)}</div>${body}
    <div class="ask-row"><button class="ask-yes content-close">Close</button></div></div>`;
  const done = () => { root.remove(); window.removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  root.addEventListener('click', (e) => {
    if (e.target === root) return done();
    const ref = e.target.closest('.note-ref');
    if (ref) { done(); window.dispatchEvent(new CustomEvent('glurff-note-link', { detail: { note: ref.dataset.note, host: ref.dataset.host } })); }
  });
  root.querySelector('.content-close').addEventListener('click', done);
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  root.querySelector('.content-close').focus();
  open = done;
}

/* A SIGN PEOPLE CAN WRITE ON (2026-11-07): what it says now, who changed it
 * last, and, for anybody in the Glurff, Write on it. It follows changes made
 * while it is open, except while we are writing. */
function showSign(item, { signs, name, isHost }) {
  const root = document.createElement('div');
  root.className = 'ask-overlay content-overlay';
  root.innerHTML = `<div class="ask content-card sign-card" role="dialog" aria-modal="true" aria-label="${esc(item.name)}">
    <div class="ask-q">${esc(item.name)}</div><div class="sign-body"></div><div class="sign-meta dim"></div><div class="ask-row"></div></div>`;
  const body = root.querySelector('.sign-body'), meta = root.querySelector('.sign-meta'), row = root.querySelector('.ask-row');
  let writing = false, busy = false;
  const paint = (said = '') => {
    const now = signs.of(item), state = signs.state();
    if (writing) {
      if (!body.querySelector('textarea')) {
        body.innerHTML = `<textarea class="sign-edit" rows="8" maxlength="${SIGN_MAX}" aria-label="What the sign says"></textarea>`;
        const t = body.querySelector('textarea'); t.value = now.text; t.oninput = () => paint(); t.focus();
      }
      const n = [...body.querySelector('textarea').value].length;
      meta.textContent = said || `${n} / ${SIGN_MAX}`;
      meta.classList.toggle('bad', n > SIGN_MAX || /^Not /.test(said));
      row.innerHTML = `<button class="ask-no sign-cancel"${busy ? ' disabled' : ''}>Cancel</button><button class="ask-yes sign-save"${busy || n > SIGN_MAX ? ' disabled' : ''}>${busy ? 'Saving…' : 'Save'}</button>`;
      return;
    }
    body.innerHTML = now.text.trim() ? textHtml(now.text) : '<div class="content-text dim">Nothing written on it yet.</div>';
    const who = now.by ? `Changed by ${esc(name(now.by))}${now.at ? `, ${ago(now.at)}` : ''}.` : '';
    const how = state === 'preview' ? 'In the Glurff, anybody in it can write on this sign; nothing is written in a playtest.'
      : state === 'shut' ? 'Only people in this Glurff can write on it.'
      : 'Anybody in this Glurff can write on it.';
    meta.innerHTML = `${said ? `<div>${esc(said)}</div>` : ''}${who ? `<div>${who}</div>` : ''}<div>${how}</div>`;
    meta.classList.remove('bad');
    row.innerHTML = `${isHost && now.by ? '<button class="ask-no sign-back">Put back the original</button>' : ''}${signs.canWrite(item) ? '<button class="ask-no sign-write">Write on it</button>' : ''}<button class="ask-yes content-close">Close</button>`;
  };
  const off = signs.on(() => { if (!writing) paint(); });
  const done = () => { off(); root.remove(); window.removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); if (writing && !busy) { writing = false; paint(); } else done(); } };
  root.addEventListener('click', async (e) => {
    if (e.target === root && !writing) return done();
    const ref = e.target.closest('.note-ref');
    if (ref) { done(); window.dispatchEvent(new CustomEvent('glurff-note-link', { detail: { note: ref.dataset.note, host: ref.dataset.host } })); return; }
    const b = e.target.closest('button'); if (!b || b.disabled) return;
    if (b.matches('.content-close')) return done();
    if (b.matches('.sign-write')) { writing = true; paint(); return; }
    if (b.matches('.sign-cancel')) { writing = false; body.innerHTML = ''; paint(); return; }
    if (b.matches('.sign-back')) {
      b.disabled = true;
      try { await signs.putBack(item); paint('Put back to what it said when published.'); } catch (err) { paint(`Not put back: ${err.message}.`); }
      return;
    }
    if (b.matches('.sign-save')) {
      const text = body.querySelector('textarea').value;
      busy = true; paint();
      try { await signs.write(item, text); busy = false; writing = false; paint('Saved. Everybody here sees it now.'); }
      catch (err) { busy = false; paint(`Not saved: ${err.message}.`); }
    }
  });
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  paint();
  signs.watch();
  root.querySelector('.content-close')?.focus();
  open = done;
}

/* A small card of our own, closed by Close, Escape or a click outside it;
 * `wire(root, done)` gives its buttons something to do. */
function card(label, html, wire = () => {}) {
  closeContent();
  const root = document.createElement('div');
  root.className = 'ask-overlay content-overlay';
  root.innerHTML = `<div class="ask content-card" role="dialog" aria-modal="true" aria-label="${esc(label)}">${html}</div>`;
  const done = () => { root.remove(); window.removeEventListener('keydown', onKey, true); open = null; };
  const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); done(); } };
  root.addEventListener('click', (e) => {
    if (e.target === root || e.target.closest('.content-close')) return done();
    const ref = e.target.closest('.note-ref');
    if (ref) { done(); window.dispatchEvent(new CustomEvent('glurff-note-link', { detail: { note: ref.dataset.note, host: ref.dataset.host } })); }
  });
  wire(root, done);
  window.addEventListener('keydown', onKey, true);
  document.body.appendChild(root);
  root.querySelector('.content-close')?.focus();
  open = done;
}

/* A CHARACTER, TAPPED (2026-11-08): what it says, and its choices -- each
 * something an item does, done by `choose(choice)` once the card is shut. */
export function showTalk(item, { choose = () => {} } = {}) {
  const d = item.do ?? {}, choices = (d.choices ?? []).filter((c) => c?.label && c.do);
  const said = (d.talk ?? '').trim() || (d.lines ?? [])[0] || '…';
  card(item.name, `<div class="ask-q">${esc(item.name)}</div>${textHtml(said)}
    <div class="ask-row talk-choices">${choices.map((c, i) => `<button class="ask-no talk-choice" data-i="${i}">${esc(c.label)}</button>`).join('')}
      <button class="ask-yes content-close">${choices.length ? 'Bye' : 'Close'}</button></div>`,
  (root, done) => root.querySelectorAll('.talk-choice').forEach((b) => b.addEventListener('click', () => { done(); choose(choices[Number(b.dataset.i)]); })));
}

/* A COLLECTIBLE, FOUND (2026-11-08): its picture, what it says, how many of
 * this Glurff's we have now -- or that we had it already -- and who else
 * here has. */
export function showFound(item, { picture = null, count = 0, total = 0, had = false, preview = false, others = [] } = {}) {
  const text = (item.do?.text ?? '').trim();
  const art = picture ? `<img class="found-picture" src="${esc(picture)}" alt="">` : '<div class="found-picture star">★</div>';
  const head = had ? 'Already in your collection' : preview ? 'Found (a playtest keeps nothing)' : 'Found!';
  card(item.name, `<div class="found">${art}<div><div class="dim">${esc(head)}</div><div class="ask-q">${esc(item.name)}</div></div></div>
    ${text ? textHtml(text) : ''}
    <div class="dim found-count">${count} of ${total} in this Glurff${others.length ? ` · also found by ${others.map(esc).join(', ')}` : ''}</div>
    <div class="ask-row"><button class="ask-yes content-close">Close</button></div>`);
}
