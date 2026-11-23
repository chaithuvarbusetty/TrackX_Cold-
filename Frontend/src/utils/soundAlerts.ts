// Pure Web Audio API synthesized alerts (zero external audio file dependencies)

let audioCtx: AudioContext | null = null;
let lastAlertPlayedMs = 0;
const STORAGE_KEY = 'tracx_audio_muted';

export function isAudioMuted(): boolean {
  if (typeof window === 'undefined') return true;
  try {
    return localStorage.getItem(STORAGE_KEY) === 'true';
  } catch {
    return false;
  }
}

export function setAudioMuted(muted: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEY, muted ? 'true' : 'false');
  } catch {}
}

export function initAudioContext(): AudioContext | null {
  if (typeof window === 'undefined') return null;
  const Ctx = window.AudioContext || (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
  if (!Ctx) return null;
  if (!audioCtx) {
    audioCtx = new Ctx();
  }
  if (audioCtx.state === 'suspended') {
    audioCtx.resume().catch(() => {});
  }
  return audioCtx;
}

export function playAlertTone(kind: 'temp_critical' | 'door_tamper' | 'resolved'): void {
  if (isAudioMuted()) return;
  const nowMs = Date.now();
  // Debounce repeated tone triggers (prevent audio stacking)
  if (kind !== 'resolved' && nowMs - lastAlertPlayedMs < 3500) {
    return;
  }
  lastAlertPlayedMs = nowMs;

  const ctx = initAudioContext();
  if (!ctx) return;

  const now = ctx.currentTime;

  if (kind === 'resolved') {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(523.25, now);
    osc.frequency.exponentialRampToValueAtTime(659.25, now + 0.14);
    gain.gain.setValueAtTime(0.08, now);
    gain.gain.exponentialRampToValueAtTime(0.001, now + 0.22);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(now);
    osc.stop(now + 0.24);
    return;
  }

  // Two-tone alert for critical temperature or door tamper (<= 3 Hz to prevent sensory overload)
  const freqs = kind === 'door_tamper' ? [880, 620, 880] : [740, 587, 740];
  freqs.forEach((freq, idx) => {
    const start = now + idx * 0.16;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = kind === 'door_tamper' ? 'triangle' : 'sine';
    osc.frequency.setValueAtTime(freq, start);
    gain.gain.setValueAtTime(0.08, start);
    gain.gain.exponentialRampToValueAtTime(0.001, start + 0.13);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(start);
    osc.stop(start + 0.14);
  });
}
