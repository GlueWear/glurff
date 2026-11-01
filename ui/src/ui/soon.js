/* THE RINGED PLANET (2026-10-31): a placeholder, beside the room button.
 *
 * It does nothing yet but say so -- "Coming soon™" on hover or keyboard focus.
 * A touch screen has no hover, so there a tap shows the same words for a
 * moment. A button like the others in the row, so the keyboard reaches it.
 */
export const SOON = 'Coming soon™';

/* A planet, its ring and a small moon. */
const PLANET_ICON = `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6"
  stroke-linecap="round" aria-hidden="true">
  <circle cx="11" cy="13" r="5.2"/>
  <path d="M5.9 15.2C2.6 17 1.6 18.6 2.4 19.6c1.2 1.4 6.6-.2 12.1-3.7 5.5-3.5 8.9-7.6 7.7-9.1-.7-.9-2.7-.6-5.4.6"/>
  <circle cx="19.5" cy="4" r="1.6" fill="currentColor" stroke="none"/>
</svg>`;

export function soonButton(root) {
  root.className = 'soon';
  root.innerHTML = `<button class="soon-btn" data-tip="${SOON}" aria-label="${SOON}">${PLANET_ICON}</button>`;
  const button = root.querySelector('button');
  let timer = null;
  button.addEventListener('click', () => {
    const touch = document.documentElement.classList.contains('touch') || !globalThis.matchMedia?.('(hover: hover)').matches;
    if (!touch) return;
    button.classList.add('tip-on'); clearTimeout(timer);
    timer = setTimeout(() => button.classList.remove('tip-on'), 1800);
  });
  return root;
}
