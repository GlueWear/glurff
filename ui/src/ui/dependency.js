import { NOLTBOOK_PUBLISHER, NOLTBOOK_DESK } from 'lib/dependency';

const esc = (s) => String(s ?? '').replace(/[&<>\"]/g, (c) =>
  ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '\"': '&quot;' }[c]));

/* A missing dependency is explained and installed in Glurff's own UI. It is
 * never silently installed: a second desk is a meaningful change to a ship. */
export function showNoltbookDependency({ watch, isAvailable = () => false,
  onAvailable = () => () => {}, reload = () => location.reload() }) {
  let root = null, reloadTimer = null, currentStatus = 'checking', installRequested = false;

  const remove = () => { root?.remove(); root = null; };
  const ensure = () => {
    if (root) return root;
    root = document.createElement('div');
    root.className = 'ask-overlay dependency-overlay';
    root.innerHTML = `<div class="ask dependency" role="dialog" aria-modal="true" aria-labelledby="dependency-title">
      <div class="ask-q" id="dependency-title">Glurff needs Noltbook</div>
      <div class="ask-detail dim">Noltbook provides Glurff's people, chat, rooms, and calls.</div>
      <div class="dependency-status" role="status"></div>
      <code class="dependency-manual">|install ${esc(NOLTBOOK_PUBLISHER)} %${esc(NOLTBOOK_DESK)}</code>
      <div class="ask-row">
        <button type="button" class="ask-yes dependency-install">Install Noltbook</button>
      </div>
    </div>`;
    root.querySelector('.dependency-install').onclick = async () => {
      if (currentStatus === 'unavailable') { reload(); return; }
      installRequested = true;
      paint({ status: 'installing' });
      try { await watch.install(); } catch {}
    };
    document.body.appendChild(root);
    return root;
  };

  const paint = (state) => {
    currentStatus = state.status;
    if (isAvailable()) { remove(); return; }
    if (state.status === 'ready' && !installRequested) { remove(); return; }
    const el = ensure(), status = el.querySelector('.dependency-status');
    const install = el.querySelector('.dependency-install');
    const manual = el.querySelector('.dependency-manual');
    if (state.status === 'checking') {
      status.textContent = 'Checking this ship for Noltbook…';
      install.disabled = true; install.textContent = 'Checking…'; manual.hidden = true;
      return;
    }
    if (state.status === 'ready') {
      status.textContent = 'Noltbook is installed. Reconnecting Glurff…';
      install.disabled = true; manual.hidden = true;
      clearTimeout(reloadTimer); reloadTimer = setTimeout(reload, 500);
      return;
    }
    if (state.status === 'installing') {
      status.textContent = `Installing Noltbook from ${NOLTBOOK_PUBLISHER}…`;
      install.disabled = true; install.textContent = 'Installing…'; manual.hidden = true;
      return;
    }
    install.disabled = false;
    if (state.status === 'unavailable') {
      status.textContent = 'Glurff could not reach the ship installer. Install Noltbook in Dojo, then reload.';
      install.textContent = 'Reload Glurff';
      manual.hidden = false;
      queueMicrotask(() => install.focus());
      return;
    }
    install.textContent = state.status === 'failed' ? 'Retry install' : 'Install Noltbook';
    if (state.status === 'failed') {
      status.textContent = `Installation failed: ${state.error || 'unknown error'}`;
      manual.hidden = false;
    } else {
      status.textContent = `Install the official Noltbook desk from ${NOLTBOOK_PUBLISHER}.`;
      manual.hidden = true;
    }
    queueMicrotask(() => install.focus());
  };

  const offWatch = watch.on(paint);
  const offAvailable = onAvailable(() => { if (isAvailable()) remove(); });
  return () => {
    clearTimeout(reloadTimer);
    offWatch(); offAvailable(); remove();
  };
}
