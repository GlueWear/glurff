/* Somebody else's movement, drawn smoothly from messages that arrive unevenly.
 *
 * WE DRAW THEM BEHIND THEIR OWN CLOCK, by just enough to always have a next
 * position to walk towards: the gap between their messages, plus how unevenly
 * those messages arrive, kept inside 150-350 ms. A sender at 8 per second on a
 * steady connection is drawn about 170 ms behind; one whose messages bunch up
 * is given more room rather than stuttering.
 *
 * PREDICTION IS SHORT AND WALL-AWARE. When their next position is late we keep
 * them walking along their last velocity for at most 150 ms, never into a solid
 * tile, and never at all once they have stopped.
 *
 * EVERY CORRECTION IS EASED. A discontinuity -- a long silence, a change in how
 * far behind we are drawing, prediction that guessed wrong -- moves them from
 * where they were DRAWN rather than snapping. The one exception is a real jump
 * across the map, which should snap.
 */
export const MIN_DELAY = 150, MAX_DELAY = 350;
const START_DELAY = 250;          //  until we have measured anything
const MARGIN_MS = 40;
const RESET_GAP_MS = 2000, SNAP_TILES = 12;
const PREDICT_MS = 150, EASE_MS = 220;
const WINDOW = 20;                //  how many recent messages shape the delay

export class MotionBuffer {
  constructor(position, at, stamp = at, {solid = () => false} = {}) {
    this.offset = at - stamp;
    this.samples = [{...position, t: at, vx: 0, vy: 0, moving: false}];
    this.solid = solid;
    this.delay = START_DELAY;
    this.lags = [];
    this.gaps = [];
    this.error = {x: 0, y: 0, at: -Infinity};
    this.render = {x: position.x, y: position.y, dir: position.dir};
  }

  push(position, at, stamp = at, motion = {}) {
    const last = this.samples.at(-1);
    this.offset = Math.min(this.offset, at - stamp);
    const t = Math.max(last.t + .001, stamp + this.offset);
    const gap = t - last.t;
    const far = Math.hypot(position.x - last.x, position.y - last.y) > SNAP_TILES;

    const seconds = gap / 1000;
    const derived = (from, to) => (seconds > 0 && seconds < 1 ? (to - from) / seconds : 0);
    const sample = {...position, t,
      vx: Number.isFinite(motion.vx) ? motion.vx : derived(last.x, position.x),
      vy: Number.isFinite(motion.vy) ? motion.vy : derived(last.y, position.y),
      moving: motion.moving ?? (Math.hypot(position.x - last.x, position.y - last.y) > .001)};

    /* Only the spacing of a CONTINUOUS walk shapes how far behind we draw.
     * Nothing is sent while somebody stands still, so the long gap on either
     * side of a pause is not jitter -- counting it would leave them drawn a
     * third of a second behind for the next few seconds of walking. */
    if (gap > 0 && gap < MAX_DELAY + MARGIN_MS && last.moving && sample.moving) {
      this.gaps.push(gap);
      if (this.gaps.length > WINDOW) this.gaps.shift();
    }
    this.retune(at, stamp);

    if (gap > RESET_GAP_MS || far) {
      /* A long silence is a discontinuity, not a journey to replay. Start from
       * where they were DRAWN, so somebody who stood still and then walks does
       * not hop the distance we were drawing behind them. A real jump across
       * the map still snaps. */
      const shown = this.render;
      this.samples = [sample];
      if (far) this.error = {x: 0, y: 0, at: -Infinity};
      else this.blendFrom(shown, at);
      return;
    }
    this.samples.push(sample);
    if (this.samples.length > 16) this.samples.shift();
  }

  /* How far behind them to draw: their message spacing plus their jitter. */
  retune(at, stamp) {
    const lag = (at - stamp) - this.offset;
    this.lags.push(Math.max(0, lag));
    if (this.lags.length > WINDOW) this.lags.shift();
    const spacing = this.gaps.length ? Math.max(...this.gaps) : START_DELAY;
    const target = Math.max(MIN_DELAY, Math.min(MAX_DELAY,
      Math.round(spacing + Math.max(...this.lags) + MARGIN_MS)));
    if (Math.abs(target - this.delay) < 10) return;
    const shown = this.point(at);
    this.delay = target;
    this.blendFrom(shown, at);
  }

  /* Carry on from a point we have already drawn, easing onto the truth. */
  blendFrom(point, now) {
    const target = this.sample(now - this.delay);
    this.error = {x: point.x - target.x, y: point.y - target.y, at: now};
  }

  /* Where they are on their own clock at buffer time `t`, ignoring easing. */
  sample(t) {
    const s = this.samples;
    if (t <= s[0].t) return s[0];
    for (let i = 1; i < s.length; i++) if (s[i].t >= t) {
      const a = s[i - 1], b = s[i], f = (t - a.t) / (b.t - a.t);
      return {x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, dir: b.dir, moving: b.moving};
    }
    return this.predict(s.at(-1), t - s.at(-1).t);
  }

  /* Past their newest position: keep them walking briefly rather than freezing.
   * Bounded, and blocked by the same walls they are. Somebody who has stopped
   * is never predicted anywhere. */
  predict(last, ahead) {
    if (!last.moving || (!last.vx && !last.vy)) return last;
    const seconds = Math.min(ahead, PREDICT_MS) / 1000;
    let x = last.x, y = last.y;
    const nx = last.x + last.vx * seconds;
    if (!this.solid(nx, last.y)) x = nx;
    const ny = last.y + last.vy * seconds;
    if (!this.solid(x, ny)) y = ny;
    return {x, y, dir: last.dir, moving: true};
  }

  point(now) {
    const raw = this.sample(now - this.delay);
    const age = now - this.error.at;
    if (!(age < EASE_MS)) return {...raw};
    const f = 1 - age / EASE_MS;
    return {...raw, x: raw.x + this.error.x * f, y: raw.y + this.error.y * f};
  }

  at(now) {
    const t = now - this.delay, s = this.samples;
    while (s.length > 2 && s[1].t <= t) s.shift();
    const point = this.point(now);
    this.render = {x: point.x, y: point.y, dir: point.dir};
    return point;
  }
}

// At most one in-flight movement plus its newest replacement per route.
export function latestSender(send) {
  const pending=new Map();let closed=false;
  async function drain(key,item) {
    while(item.next && !closed) {
      const value=item.next;item.next=null;
      try {await send(...value);}catch{}
    }
    pending.delete(key);
  }
  return {
    put(key,...args) {
      if(closed)return;
      const existing=pending.get(key);
      if(existing){existing.next=args;return;}
      if(pending.size>=256)return;
      const item={next:args};pending.set(key,item);void drain(key,item);
    },
    cancel(key){const item=pending.get(key);if(item)item.next=null;},
    close(){closed=true;for(const item of pending.values())item.next=null;},
  };
}
