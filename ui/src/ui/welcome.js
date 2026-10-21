/* THE FIRST VISIT (2026-10-21). Somebody arriving for the first time is shown,
 * once, how Glurff is played: walking, talking, chat, people, themselves. A
 * phone is told about its stick and taps instead of keys and clicks.
 *
 * Once per browser: remembered in localStorage, which is all it needs -- a
 * cleared browser seeing it again costs one click. Not shown to an automated
 * browser (navigator.webdriver), which has no use for it and would only have
 * it in the way.
 */
const KEY = 'glurff-welcomed';

const ROWS = (touch) => [
  ['Walk', touch ? 'Push the stick at the bottom left. Hold it at the edge to run.'
    : 'WASD or the arrow keys. Tap a direction twice to run.'],
  ['Talk', 'Walk up to people to talk with them; rooms have calls of their own. Your microphone and camera are in the call bar.'],
  ['Chat', touch ? 'Tap the chat button, bottom right, to write to everyone in the room.'
    : 'Click Open chat to write to everyone in the room.'],
  ['People', `${touch ? 'Tap' : 'Click'} anyone to see their card, send them a message or add them as a pal.`],
  ['You', 'Your name at the top right opens your profile, and your character.'],
  ['Look around', touch ? 'Drag to look around, pinch to zoom.' : 'Drag to look around; + and − zoom; B to emote.'],
];

function seen() {
  try { return !!localStorage.getItem(KEY); } catch { return false; }
}
function remember() {
  try { localStorage.setItem(KEY, String(Date.now())); } catch {}
}

/* The card itself, whether or not it has been seen. Resolves when it closes. */
export function showWelcome({ touch = false } = {}) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'welcome-overlay';
    root.innerHTML = `<section class="welcome" role="dialog" aria-modal="true" aria-labelledby="welcome-title">
      <h2 id="welcome-title">Welcome to Glurff</h2>
      <dl>${ROWS(touch).map(([what, how]) => `<div><dt>${what}</dt><dd>${how}</dd></div>`).join('')}</dl>
      <div class="welcome-foot"><button type="button" class="primary welcome-go">Let’s go</button></div>
    </section>`;
    const done = () => {
      remember();
      window.removeEventListener('keydown', onKey, true);
      root.remove();
      resolve();
    };
    const onKey = (e) => { if (e.key === 'Escape' || e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); done(); } };
    root.querySelector('.welcome-go').onclick = done;
    root.addEventListener('click', (e) => { if (e.target === root) done(); });
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    root.querySelector('.welcome-go').focus({ preventScroll: true });
  });
}

/* At the end of the first arrival: the card, unless it has been seen. */
export function welcomeOnce(options) {
  if (seen() || (typeof navigator !== 'undefined' && navigator.webdriver)) return null;
  return showWelcome(options);
}
