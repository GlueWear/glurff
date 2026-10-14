/* SENDING $NOCK FROM A MESSAGE (2026-10-13): Noltbook's SEND, in Glurff's own
 * dialog. How much, what the network will charge (lib/wallet previewFee), and
 * Send -- which is Iris's window, then the payment message in the chat the
 * send was made from. Resolves with what was sent, or null.
 */
import { esc } from 'ui/html';
import { pay, previewFee, unlockIris, sendError } from 'lib/wallet';

export function sendBox({ ship, name, at }) {
  return new Promise((resolve) => {
    const root = document.createElement('div');
    root.className = 'ask-overlay';
    root.innerHTML = `<form class="ask send-box" role="dialog" aria-modal="true" aria-label="Send $NOCK">
      <div class="ask-q">Send $NOCK to ${esc(name)}</div>
      <input class="send-box-amount" type="number" min="0" step="0.0001" placeholder="NOCK" autocomplete="off" required>
      <div class="send-fee dim" aria-live="polite"></div>
      <div class="send-box-status" role="status"></div>
      <div class="ask-row">
        <button type="button" class="ask-no">Cancel</button>
        <button type="submit" class="ask-yes">Send</button>
      </div>
    </form>`;
    const form = root.querySelector('form'), input = root.querySelector('input');
    const fee = root.querySelector('.send-fee'), status = root.querySelector('.send-box-status');
    let busy = false, timer = null, seq = 0, retries = 0;
    const done = (v) => { clearTimeout(timer); window.removeEventListener('keydown', onKey, true); root.remove(); resolve(v); };
    const onKey = (e) => { if (e.key === 'Escape' && !busy) { e.preventDefault(); e.stopPropagation(); done(null); } };
    const showFee = async () => {
      const mine = ++seq;
      if (!(Number(input.value) > 0)) { fee.textContent = ''; return; }
      fee.textContent = 'Working out the network fee…';
      const r = await previewFee(ship, input.value);
      if (mine !== seq) return;
      if (r.busy && retries++ < 3) { timer = setTimeout(showFee, 500); return; }
      retries = 0;
      fee.textContent = r.text;
      if (r.locked) {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'send-unlock'; b.textContent = 'Unlock';
        b.onclick = async () => { fee.textContent = 'Unlock Iris in its window…'; await unlockIris(); showFee(); };
        fee.append(' ', b);
      }
    };
    input.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(showFee, 500); });
    root.querySelector('.ask-no').onclick = () => { if (!busy) done(null); };
    root.addEventListener('click', (e) => { if (e.target === root && !busy) done(null); });
    form.onsubmit = async (e) => {
      e.preventDefault();
      if (busy) return;
      busy = true; form.classList.add('busy');
      status.textContent = 'Approve it in Iris…';
      try {
        const sent = await pay({ ship, amount: input.value, at });
        done(sent);
      } catch (err) {
        busy = false; form.classList.remove('busy');
        status.textContent = sendError(err);
      }
    };
    window.addEventListener('keydown', onKey, true);
    document.body.appendChild(root);
    input.focus();
  });
}
