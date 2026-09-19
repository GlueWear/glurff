/* Recording a call, in the recorder's own browser.
 *
 * Nothing is uploaded and nothing is written to Noltbook: the file is made
 * here, from what this browser is already receiving, and saved to this
 * machine. Noltbook's design, followed deliberately -- it is the one people in
 * a call already understand.
 *
 * THE HOST DECIDES WHO IS RECORDING. Pressing the button asks; the recorder
 * starts only once the authoritative record names us, and stops the moment it
 * stops naming us -- stopped by the host, we left, we were booted, hosting
 * moved, or the call ended. That is what makes the red REC notice everyone
 * else sees trustworthy: it is the same record, not a claim from the recorder.
 *
 * What goes in:
 *   audio  our own outgoing audio, plus every participant an admin has not
 *          muted -- what the recorder can actually hear;
 *   video  the call's own tiles drawn to 1280x720, shared screens given the
 *          space and everybody's label kept.
 */

/* Stop and save before the tab runs out of memory rather than dying with the
 * recording in it. */
export const MAX_BYTES = 1536 * 1024 * 1024;
const FPS = 15;
const W = 1280, H = 720;

/* The same order Noltbook tries, so a file from either plays in the same
 * places. */
export const pickMime = (audioOnly, Recorder = globalThis.MediaRecorder) => {
  const want = audioOnly
    ? ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4']
    : ['video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4'];
  if (typeof Recorder?.isTypeSupported !== 'function') return '';
  for (const m of want) if (Recorder.isTypeSupported(m)) return m;
  return '';
};

export const canRecord = () => typeof globalThis.MediaRecorder !== 'undefined';

export function createRecorder({ our, tiles = () => [], audioTracks = () => [],
  displayName = (s) => s, save = defaultSave, changed = () => {},
  trace = () => {}, now = Date.now,
  Recorder = () => globalThis.MediaRecorder, Context = () => globalThis.AudioContext ?? globalThis.webkitAudioContext,
  every = (fn, ms) => setInterval(fn, ms), stopEvery = (id) => clearInterval(id) } = {}) {
  let state = null;   //  {call, audioOnly, ctx, dest, sources, canvas, recorder, parts, bytes, startedAt, mime}
  let stopping = false;
  let asked = null;   //  {call, audioOnly, at} -- waiting for the host to name us

  const active = () => !!state && !stopping;

  /* Wire up every audio track we are allowed to record, and drop the ones we
   * are not. Called as people arrive, leave and are muted. */
  function syncAudio() {
    if (!state?.ctx || !state.dest) return;
    const want = new Map();
    for (const { key, track } of audioTracks()) if (track?.readyState === 'live') want.set(key, track);
    for (const [key, node] of state.sources) {
      if (want.has(key)) continue;
      try { node.disconnect(); } catch {}
      state.sources.delete(key);
    }
    for (const [key, track] of want) {
      if (state.sources.has(key)) continue;
      try {
        const src = state.ctx.createMediaStreamSource(new MediaStream([track]));
        src.connect(state.dest);
        state.sources.set(key, src);
      } catch {}
    }
  }

  /* The picture: the call's own tiles, so the recording matches what the
   * recorder was looking at. Shared screens get three quarters of the frame. */
  function draw() {
    const cv = state?.canvas;
    if (!cv) return;
    const g = cv.getContext('2d');
    g.fillStyle = '#000';
    g.fillRect(0, 0, W, H);
    const all = tiles();
    const screens = all.filter((t) => t.screen);
    const cams = all.filter((t) => !t.screen);
    const cell = (t, x, y, w, h) => {
      g.fillStyle = '#161616';
      g.fillRect(x + 2, y + 2, w - 4, h - 4);
      const v = t.video;
      if (v && v.videoWidth > 0 && v.readyState >= 2) {
        const sc = Math.min((w - 4) / v.videoWidth, (h - 4) / v.videoHeight);
        const dw = v.videoWidth * sc, dh = v.videoHeight * sc;
        try { g.drawImage(v, x + (w - dw) / 2, y + (h - dh) / 2, dw, dh); } catch {}
      }
      const label = t.label === 'You' ? displayName(our) : t.label;
      if (!label) return;
      const fs = Math.max(13, Math.min(24, Math.round(h / 16)));
      g.font = `500 ${fs}px system-ui,-apple-system,sans-serif`;
      const pad = 6, th = fs + 10;
      const tw = Math.min(w - 4, g.measureText(label).width + pad * 2);
      g.fillStyle = 'rgba(0,0,0,.75)';
      g.fillRect(x + 2, y + h - th - 2, tw, th);
      g.fillStyle = '#fff';
      g.textBaseline = 'middle';
      g.fillText(label, x + 2 + pad, y + h - 2 - th / 2, tw - pad * 2);
    };
    const grid = (l, x, y, w, h) => {
      if (!l.length) return;
      const cols = Math.ceil(Math.sqrt(l.length)), rows = Math.ceil(l.length / cols);
      const cw = w / cols, ch = h / rows;
      l.forEach((t, i) => cell(t, x + (i % cols) * cw, y + Math.floor(i / cols) * ch, cw, ch));
    };
    if (screens.length) { grid(screens, 0, 0, W * 0.75, H); grid(cams, W * 0.75, 0, W * 0.25, H); }
    else grid(cams, 0, 0, W, H);
  }

  function begin(call, audioOnly) {
    const MR = Recorder(), AC = Context();
    if (!MR || !AC) return false;
    try {
      const ctx = new AC();
      try { ctx.resume?.(); } catch {}
      state = { call, audioOnly: !!audioOnly, ctx, dest: ctx.createMediaStreamDestination(),
                sources: new Map(), canvas: null, recorder: null, parts: [], bytes: 0,
                startedAt: now(), mime: '', drawTimer: null };
      syncAudio();
      let stream = state.dest.stream;
      if (!audioOnly) {
        const cv = typeof document !== 'undefined' ? document.createElement('canvas') : null;
        if (cv) {
          cv.width = W; cv.height = H;
          state.canvas = cv;
          draw();
          state.drawTimer = every(draw, Math.round(1000 / FPS));
          stream = new MediaStream([...cv.captureStream(FPS).getVideoTracks(),
                                    ...state.dest.stream.getAudioTracks()]);
        }
      }
      const mime = pickMime(audioOnly, MR);
      const mr = mime ? new MR(stream, { mimeType: mime }) : new MR(stream);
      state.recorder = mr;
      state.mime = mr.mimeType || mime || (audioOnly ? 'audio/webm' : 'video/webm');
      mr.ondataavailable = (e) => {
        if (!e.data || !e.data.size) return;
        state.parts.push(e.data);
        state.bytes += e.data.size;
        if (state.bytes >= MAX_BYTES && !stopping) { trace('call-rec', { reason: 'too-big' }); finish(); }
      };
      mr.onstop = () => saveNow();
      mr.onerror = () => { if (!stopping) finish(); };
      mr.start(1000);
      trace('call-rec', { reason: 'started', place: call.place, audioOnly: !!audioOnly });
      changed();
      return true;
    } catch (e) {
      trace('call-rec', { reason: 'start-failed' });
      cleanup();
      return false;
    }
  }

  function finish() {
    if (!state || stopping) return;
    stopping = true;
    const mr = state.recorder;
    if (mr && mr.state !== 'inactive') { try { mr.stop(); return; } catch {} }
    saveNow();
  }

  function saveNow() {
    try {
      if (state?.parts.length) {
        const type = (state.mime || 'video/webm').split(';')[0];
        const blob = new Blob(state.parts, { type });
        const ext = type.includes('mp4') ? (state.audioOnly ? 'm4a' : 'mp4') : 'webm';
        const at = new Date(state.startedAt || now()).toISOString().replace(/[:.]/g, '-').slice(0, 19);
        save(blob, `glurff-call-${at}${state.audioOnly ? '-audio' : ''}.${ext}`);
        trace('call-rec', { reason: 'saved', bytes: state.bytes });
      }
    } catch { trace('call-rec', { reason: 'save-failed' }); }
    finally { cleanup(); }
  }

  function cleanup() {
    if (state?.drawTimer) stopEvery(state.drawTimer);
    for (const node of state?.sources?.values() ?? []) { try { node.disconnect(); } catch {} }
    try { state?.ctx?.close?.(); } catch {}
    state = null;
    stopping = false;
    changed();
  }

  return {
    /* Press. We do not start here: we ask, and `follow` starts us when the
     * record says we are the recorder. */
    ask(call, audioOnly) { asked = { call, audioOnly: !!audioOnly, at: now() }; changed(); },
    asked: () => asked,
    cancel() { asked = null; changed(); },

    /* Follow the authoritative record. This is the only thing that starts or
     * stops the recorder. */
    follow(record, call, recording) {
      if (asked) {
        const stale = !call || asked.call.place !== call.place || asked.call.host !== call.host ||
                      (asked.call.gen ?? 0) !== (call.gen ?? 0) || now() - asked.at > 15000 ||
                      (recording && recording.by !== our);
        if (stale) asked = null;
        else if (recording?.by === our && !state) { const want = asked; asked = null; begin(call, want.audioOnly); }
      }
      if (!state || stopping) return;
      const mine = recording?.by === our;
      const sameCall = call && state.call.place === call.place && state.call.host === call.host &&
                       (state.call.gen ?? 0) === (call.gen ?? 0);
      if (!mine || !sameCall) { trace('call-rec', { reason: 'no-longer-ours' }); finish(); return; }
      syncAudio();
    },

    stop() { asked = null; finish(); },
    active,
    elapsed: () => (state ? Math.max(0, Math.floor((now() - state.startedAt) / 1000)) : 0),
    bytes: () => state?.bytes ?? 0,
    audioOnly: () => !!state?.audioOnly,
  };
}

/* Saving is a download. Kept separate so a test can take the blob instead. */
function defaultSave(blob, name) {
  if (typeof document === 'undefined') return;
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 60000);
}
