import { nb, worldStatus, worldJoined, retryWorld, onChange } from 'lib/noltbook';

/* Membership failures must not look like an empty, disconnected world. */
export function showWorldMembership() {
  let root = null;
  const remove = () => { root?.remove(); root = null; };
  const paint = () => {
    const state = worldStatus();
    if (!nb.ready || worldJoined() || state.phase === 'stopped') { remove(); return; }
    if (!root) {
      root = document.createElement('div');
      root.className = 'ask-overlay world-membership-overlay';
      root.innerHTML = `<div class="ask" role="dialog" aria-modal="true" aria-labelledby="world-membership-title">
        <div class="ask-q" id="world-membership-title"></div>
        <div class="ask-detail" role="status"></div>
        <div class="ask-row"><button type="button">Retry</button></div>
      </div>`;
      document.body.appendChild(root);
      root.querySelector('button').onclick = () => retryWorld();
    }
    const copy = {
      waiting: ['Connecting to Glurff…', 'Preparing your membership.'],
      joining: ['Joining Glurff…', 'Connecting to the shared world.'],
      member: ['Connecting to Glurff…', 'Finishing account checks.'],
      retrying: ['Waiting for Glurff', 'The world host has not answered yet. We’ll keep trying.'],
      banned: ['Access to Glurff was removed', 'A host or administrator must restore your membership.'],
      denied: ['Unable to join Glurff', 'The world host did not approve your request.'],
      left: ['You left Glurff', 'Open Glurff again to rejoin.'],
      'config-error': ['Glurff is unavailable', 'The official shared note could not be verified.'],
    }[state.phase] ?? ['Connecting to Glurff…', 'Preparing your membership.'];
    root.querySelector('.ask-q').textContent = copy[0];
    root.querySelector('.ask-detail').textContent = copy[1];
    root.querySelector('button').hidden = !['retrying', 'denied'].includes(state.phase);
  };
  const off = onChange(paint, c => ['world', 'notes', 'pals'].includes(c.field));
  paint();
  return () => { off(); remove(); };
}
