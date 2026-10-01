/* ON A PHONE: a joystick to walk with, bottom left, and -- when we hold a
 * weapon -- a button that takes it out or puts it away, as "1" does on a
 * keyboard. Out, a tap on the world attacks there (see main's onTap).
 *
 * Shown only where touch is how the world is played: a phone or tablet, or
 * anything somebody has touched (html.touch). The rest of the phone layout is
 * style.css; it is told two things it cannot measure for itself -- how tall
 * the call bar is (--rail-h) and how much of the page the on-screen keyboard
 * covers (--kb).
 */
import { stickVector, keyboardCover } from 'lib/touch';

const SWORD = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<path d="M14.5 17.5 3 6V3h3l11.5 11.5"/><path d="m13 19 6-6"/><path d="m16 16 4 4"/><path d="m19 21 2-2"/></svg>';

/* html.touch: from the start on a phone or tablet, and from the first touch on
 * anything else. Never taken away -- a laptop with a touchscreen keeps its
 * joystick once somebody has used the screen. */
export function watchTouch(doc = document, win = window) {
  const mark = () => doc.documentElement.classList.add('touch');
  if (win.matchMedia?.('(pointer: coarse)').matches) mark();
  win.addEventListener('pointerdown', (e) => { if (e.pointerType === 'touch') mark(); }, { capture: true, passive: true });
  /* iOS zooms the whole page on a pinch, whatever the viewport says; the world
   * has its own pinch. */
  doc.addEventListener('gesturestart', (e) => e.preventDefault());
}
export const touching = (doc = document) => doc.documentElement.classList.contains('touch');

/* The two measurements the phone layout needs. */
export function watchLayout(rail, doc = document, win = window) {
  const root = doc.documentElement.style;
  if (rail && win.ResizeObserver) {
    new win.ResizeObserver(() => root.setProperty('--rail-h', `${Math.round(rail.offsetHeight)}px`)).observe(rail);
  }
  /* iOS scrolls the whole page to show a field being typed in, and leaves it
   * scrolled when the keyboard goes: put it back. */
  win.addEventListener('focusout', () => win.setTimeout(() => { if (win.scrollY || win.scrollX) win.scrollTo(0, 0); }, 60));
  const vv = win.visualViewport;
  if (!vv) return;
  const keyboard = () => root.setProperty('--kb', `${keyboardCover(win.innerHeight, vv)}px`);
  vv.addEventListener('resize', keyboard);
  vv.addEventListener('scroll', keyboard);
  keyboard();
}

export class TouchControls {
  constructor(root, { game, onArm = () => {}, weaponReady = () => false } = {}) {
    Object.assign(this, { root, game, onArm, weaponReady });
    root.className = 'touch-controls';
    root.innerHTML = `<div class="stick" aria-label="Walk: hold and push the way to go; push to the edge to run"><i class="stick-knob"></i></div>
      <button type="button" class="weapon-btn" aria-pressed="false" title="Take your weapon out, or put it away" hidden>${SWORD}</button>`;
    this.stick = root.querySelector('.stick');
    this.knob = root.querySelector('.stick-knob');
    this.weapon = root.querySelector('.weapon-btn');
    this.held = null;
    this.weapon.onclick = () => { this.onArm(); this.paint(); };
    this.wireStick();
    this.paint();
  }

  /* One thumb at a time; it keeps the stick until it lets go, wherever it
   * wanders. */
  wireStick() {
    const { stick, knob } = this;
    const steer = (e) => {
      const r = stick.getBoundingClientRect(), w = r.width;
      const { knob: at, walk } = stickVector(e.clientX - (r.left + w / 2), e.clientY - (r.top + r.height / 2), w / 2);
      /* The knob stays inside the ring; the thumb may reach past it. */
      const k = w > 0 ? (w - knob.offsetWidth) / w : 0;
      knob.style.transform = `translate(${Math.round(at.x * k)}px, ${Math.round(at.y * k)}px)`;
      stick.classList.toggle('run', !!walk?.run);
      this.game.setStick(walk);
    };
    const letGo = (e) => {
      if (e.pointerId !== this.held) return;
      this.held = null;
      stick.classList.remove('held', 'run');
      knob.style.transform = '';
      this.game.setStick(null);
    };
    stick.addEventListener('pointerdown', (e) => {
      e.preventDefault();
      if (this.held !== null) return;
      this.held = e.pointerId;
      try { stick.setPointerCapture(e.pointerId); } catch {}
      stick.classList.add('held');
      steer(e);
    });
    stick.addEventListener('pointermove', (e) => { if (e.pointerId === this.held) steer(e); });
    stick.addEventListener('contextmenu', (e) => e.preventDefault());
    for (const type of ['pointerup', 'pointercancel', 'lostpointercapture']) stick.addEventListener(type, letGo);
  }

  /* The weapon button: there only with a weapon to hold, lit while it is out. */
  paint() {
    const ready = !!this.weaponReady(), out = !!this.game?.armed;
    this.weapon.hidden = !ready;
    this.weapon.classList.toggle('on', ready && out);
    this.weapon.setAttribute('aria-pressed', String(ready && out));
    this.weapon.setAttribute('aria-label', out ? 'Put your weapon away' : 'Take your weapon out');
  }
}
