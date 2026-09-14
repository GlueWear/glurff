/* Which microphone, camera and speaker to use.
 *
 * Browsers hand out device LABELS only once a capture has been permitted, so
 * an enumeration made before the first getUserMedia returns entries with empty
 * names. That is why the list is re-read after every successful capture rather
 * than once at boot: the picker fills in with real names the moment the user
 * has said yes to anything.
 *
 * Choices persist per browser. Device ids are stable per origin, but a device
 * that has been unplugged simply is not in the list any more, so a saved id is
 * always treated as a preference and never as a guarantee -- an id that no
 * longer resolves falls back to the system default instead of failing capture.
 */
const KEY = 'glurff.devices';

export const devices = { mic: [], cam: [], out: [] };

/* The saved preference, which may name a device that is not currently here. */
let chosen = load();

function load() {
  try {
    return { ...{ mic: '', cam: '', out: '', noise: true }, ...JSON.parse(localStorage.getItem(KEY) || '{}') };
  } catch (e) {
    return { mic: '', cam: '', out: '', noise: true };
  }
}

function save() {
  try { localStorage.setItem(KEY, JSON.stringify(chosen)); } catch (e) {}
}

const listeners = new Set();
export const onDevices = (fn) => { listeners.add(fn); return () => listeners.delete(fn); };
const changed = () => listeners.forEach((f) => { try { f(); } catch (e) { console.error(e); } });

export async function refreshDevices() {
  if (!navigator.mediaDevices?.enumerateDevices) return devices;
  let list = [];
  try { list = await navigator.mediaDevices.enumerateDevices(); } catch (e) { return devices; }
  const pick = (kind) => list
    .filter((d) => d.kind === kind)
    .map((d, i) => ({ id: d.deviceId, label: d.label || `${niceKind(kind)} ${i + 1}` }));
  devices.mic = pick('audioinput');
  devices.cam = pick('videoinput');
  devices.out = pick('audiooutput');
  changed();
  return devices;
}

const niceKind = (k) =>
  k === 'audioinput' ? 'Microphone' : k === 'videoinput' ? 'Camera' : 'Speaker';

/* Devices come and go while the app is open -- a headset is plugged in mid
 * conversation and the list has to follow. */
if (typeof navigator !== 'undefined' && navigator.mediaDevices?.addEventListener) {
  navigator.mediaDevices.addEventListener('devicechange', () => { refreshDevices(); });
}

export const chosenDevice = (kind) => chosen[kind] || '';

export function chooseDevice(kind, id) {
  chosen[kind] = id || '';
  save();
  changed();
}

/* `exact` would fail the whole capture when a saved device is gone; `ideal`
 * degrades to the system default instead, which is what someone who swapped
 * headsets actually wants. */
const ideal = (kind) => (chosen[kind] ? { deviceId: { ideal: chosen[kind] } } : true);
export const noiseReduction = () => chosen.noise !== false;
export const setNoiseReduction = on => { chosen.noise = !!on; save(); changed(); };
export const micConstraints = () => ({ audio: { ...(chosen.mic ? {deviceId:{ideal:chosen.mic}} : {}), echoCancellation:{ideal:true}, autoGainControl:{ideal:true}, noiseSuppression:{ideal:noiseReduction()}, channelCount:{ideal:1} } });
export const camConstraints = () => ({ video: ideal('cam') });

/* Output selection is Chromium-only (setSinkId). Elsewhere the picker is
 * hidden rather than shown broken. */
export const canPickOutput = () =>
  typeof HTMLMediaElement !== 'undefined' && 'setSinkId' in HTMLMediaElement.prototype;

export async function applyOutput(el) {
  if (!el || !canPickOutput() || !chosen.out) return;
  try { await el.setSinkId(chosen.out); } catch (e) {}
}
