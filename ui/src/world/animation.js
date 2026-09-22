/* Cosmetic animation only. Idle art plays once on request; standing still
 * holds its first frame. A hit interrupts an emote or attack, while falling
 * and getting up cannot be interrupted or repeatedly extended by more hits. */
export class CharacterAnimation {
  constructor() { this.action = null; this.mode = 'idle'; this.since = 0; }
  emote(now, frames = 16) {
    if (this.action && now < this.action.since + this.action.duration) return false;
    this.action = {kind:'emote', since:now, frames, duration:frames*200};
    return true;
  }
  attack(now, frames = 8) {
    if (this.locked(now)) return false;
    this.action = {kind:'attack', since:now, frames, duration:frames*100};
    return true;
  }
  hit(now, frames = 12, kind = 'die') {
    if (this.locked(now)) return false;
    this.action = {kind, since:now, frames, duration:frames*100*(kind==='die'?2:1)};
    return true;
  }
  locked(now) { return !!this.action && !['attack','emote'].includes(this.action.kind) && now < this.action.since+this.action.duration; }
  pose(now, moving, counts = {}) {
    // Taking a step cancels the requested idle routine without locking movement.
    if (moving && this.action?.kind === 'emote') this.action = null;
    const a = this.action;
    if (a && now < a.since+a.duration) {
      if (a.kind === 'emote') {
        const frame = Math.min(a.frames-1, Math.floor((now-a.since)/200));
        return {animation:'idle', frame, cycle:frame, progress:(now-a.since)/a.duration};
      }
      const step = Math.max(0, Math.floor((now-a.since)/100));
      const frame = a.kind==='die' && step >= a.frames ? 2*a.frames-1-step : step;
      return {animation:a.kind, frame:Math.min(a.frames-1, frame), progress:(now-a.since)/a.duration};
    }
    this.action = null;
    const mode = moving ? 'walk' : 'idle';
    if (mode !== this.mode) { this.mode=mode; this.since=now; }
    const cycle = moving ? Math.floor(Math.max(0,now-this.since)/200) : 0;
    return {animation:mode, frame:cycle % (counts[mode] ?? (moving?4:16)), cycle, progress:0};
  }
}
