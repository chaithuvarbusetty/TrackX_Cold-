import type { AlertSeverity, ConditionStatus, OperationalState } from '../shared/types';

export function formatTemp(val: number | null | undefined, digits = 2): string {
  if (val === null || val === undefined || Number.isNaN(val)) return '--';
  return `${val.toFixed(digits)}°C`;
}

export function formatHms(ms: number): string {
  const totalSec = Math.max(0, Math.floor(ms / 1000));
  const hrs = Math.floor((totalSec / 3600) % 24);
  const mins = Math.floor((totalSec % 3600) / 60);
  const secs = totalSec % 60;
  return [hrs, mins, secs].map((n) => String(n).padStart(2, '0')).join(':');
}

export function formatLiveClock(ms: number): string {
  const d = new Date(ms);
  return d.toLocaleTimeString([], {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export function formatRelativeAge(lastSeenMs: number, nowMs: number): string {
  const sec = Math.max(0, Math.floor((nowMs - lastSeenMs) / 1000));
  if (sec < 2) return 'Live (0s)';
  if (sec < 60) return `${sec}s ago`;
  if (sec < 3600) return `${Math.floor(sec / 60)}m ${sec % 60}s ago`;
  return `${Math.floor(sec / 3600)}h ago`;
}

export function getConditionBadgeClass(status: ConditionStatus): string {
  if (status === 'EXCURSION') {
    return 'text-rose-300 bg-rose-500/15 border-rose-500/35';
  }
  if (status === 'WARNING') {
    return 'text-amber-300 bg-amber-500/15 border-amber-500/35';
  }
  return 'text-emerald-300 bg-emerald-500/15 border-emerald-500/35';
}

export function getOperationalBadgeClass(state: OperationalState): string {
  if (state === 'IN_TRANSIT') {
    return 'text-sky-300 bg-sky-500/15 border-sky-500/35';
  }
  if (state === 'AT_STOP') {
    return 'text-amber-300 bg-amber-500/15 border-amber-500/35';
  }
  return 'text-slate-400 bg-slate-800/70 border-slate-700';
}

export function getSeverityBadgeClass(severity: AlertSeverity): string {
  if (severity === 'CRITICAL') {
    return 'text-rose-300 bg-rose-500/15 border-rose-500/35';
  }
  if (severity === 'HIGH') {
    return 'text-orange-300 bg-orange-500/15 border-orange-500/35';
  }
  if (severity === 'MEDIUM') {
    return 'text-amber-300 bg-amber-500/15 border-amber-500/35';
  }
  return 'text-sky-300 bg-sky-500/15 border-sky-500/35';
}

export function getSignalQualityLabel(rssiDbm: number): {
  label: string;
  bars: number;
  colorClass: string;
} {
  if (rssiDbm >= -75) {
    return { label: 'EXCELLENT', bars: 4, colorClass: 'text-emerald-400' };
  }
  if (rssiDbm >= -88) {
    return { label: 'GOOD', bars: 3, colorClass: 'text-sky-400' };
  }
  if (rssiDbm >= -98) {
    return { label: 'FAIR', bars: 2, colorClass: 'text-amber-400' };
  }
  return { label: 'POOR', bars: 1, colorClass: 'text-rose-400' };
}
