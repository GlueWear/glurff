/* The Game Room's hidden-map sequence.
 *
 * These are broad strips of floor around the pool table, not exact points.
 * Entering them top -> left -> bottom -> right is counterclockwise on screen.
 * The first strip only establishes where the walk began; eight subsequent
 * transitions are two complete circuits back to that same side. */
export const POOL_CHECKPOINTS = [
  { x0: 36.0, y0: 24.0, x1: 40.0, y1: 25.0 },    // top / entrance side
  { x0: 35.75, y0: 24.75, x1: 37.0, y1: 27.5 }, // left
  { x0: 36.0, y0: 26.5, x1: 41.5, y1: 27.75 },  // bottom
  { x0: 39.75, y0: 24.75, x1: 41.75, y1: 27.25 }, // right
];

/* The plant itself touches the room's outer wall.  This is the reachable floor
 * immediately under its leaves, where a character visually stands on it. */
export const PLANT = { x0: 44.65, y0: 27.35, x1: 45.22, y1: 28.45 };
export const MAIN_RETURN = { x: 44.6, y: 27.75, dir: 'left' };

/* Checkpoints make the intended route explicit, while angular progress makes
 * a natural hand-driven loop reliable when it clips a corner of one strip.
 * Screen y grows downward, so counterclockwise travel decreases atan2. */
const POOL_CENTRE = { x: 38.3, y: 25.6 };
const ORBIT_MIN = 0.65, ORBIT_MAX = 4.25;
const TWO_LAPS = Math.PI * 4;

const inside = (point, box) => point.x >= box.x0 && point.x <= box.x1 &&
  point.y >= box.y0 && point.y <= box.y1;

export class SecretRoomQuest {
  constructor(gameRoom, { timeout = 45000, plantDwell = 650 } = {}) {
    this.gameRoom = gameRoom;
    this.timeout = timeout;
    this.plantDwell = plantDwell;
    this.reset();
  }

  reset() {
    this.lastZone = -1;
    this.insideZone = -1;
    this.nextZone = -1;
    this.transitions = 0;
    this.startedAt = null;
    this.armed = false;
    this.plantSince = null;
    this.orbitAngle = null;
    this.orbitProgress = 0;
  }

  begin(zone, now) {
    this.lastZone = zone;
    this.nextZone = (zone + 1) % POOL_CHECKPOINTS.length;
    this.transitions = 0;
    this.startedAt = now;
    this.armed = false;
    this.plantSince = null;
  }

  updateOrbit(point) {
    if (this.armed) return;
    const dx = point.x - POOL_CENTRE.x, dy = point.y - POOL_CENTRE.y;
    const radius = Math.hypot(dx, dy);
    if (radius < ORBIT_MIN || radius > ORBIT_MAX) {
      this.orbitAngle = null;
      return;
    }
    const angle = Math.atan2(dy, dx);
    if (this.orbitAngle !== null) {
      let delta = angle - this.orbitAngle;
      if (delta > Math.PI) delta -= Math.PI * 2;
      else if (delta < -Math.PI) delta += Math.PI * 2;
      /* Clockwise movement removes progress, so pacing back and forth cannot
       * impersonate two counterclockwise circuits. */
      this.orbitProgress = Math.max(0, this.orbitProgress - delta);
      if (this.orbitProgress >= TWO_LAPS - 0.25) this.armed = true;
    }
    this.orbitAngle = angle;
  }

  update(point, now) {
    if (point.scene !== 'main' || point.room !== this.gameRoom) {
      this.reset();
      return false;
    }
    if (this.startedAt !== null && now - this.startedAt > this.timeout) this.reset();

    const zone = POOL_CHECKPOINTS.findIndex(box => inside(point, box));
    if (zone !== this.insideZone) {
      this.insideZone = zone;
      /* Once two laps are complete, crossing another checkpoint on the way to
       * the plant must not start a new attempt and erase the armed state. */
      if (zone >= 0 && !this.armed) {
        if (this.startedAt === null) this.begin(zone, now);
        else if (zone === this.nextZone) {
          this.lastZone = zone;
          this.nextZone = (zone + 1) % POOL_CHECKPOINTS.length;
          this.transitions++;
          if (this.transitions >= POOL_CHECKPOINTS.length * 2) this.armed = true;
        } else if (zone !== this.lastZone) {
          /* A skipped or clockwise checkpoint can still be the beginning of a
           * fresh attempt, so recovery never requires leaving the room. */
          this.begin(zone, now);
        }
      }
    }

    this.updateOrbit(point);

    if (!this.armed || !inside(point, PLANT)) {
      this.plantSince = null;
      return false;
    }
    if (this.plantSince === null) this.plantSince = now;
    if (now - this.plantSince < this.plantDwell) return false;
    this.reset();
    return true;
  }
}
