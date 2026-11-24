import React, { useEffect, useMemo, useState } from 'react';
import {
  Activity,
  Bell,
  Check,
  CheckCircle2,
  Database,
  Droplets,
  FlaskConical,
  HeartPulse,
  Info,
  Microscope,
  Package,
  Play,
  Send,
  ShieldAlert,
  ShieldPlus,
  Smartphone,
  Syringe,
  TestTube2,
  Trash2,
  Volume2,
  Wifi,
  X,
} from 'lucide-react';
import type {
  AlertItem,
  AlertStatus,
  DbDiagnosticsPayload,
  FleetTableRow,
  ModuleId,
} from '../shared/types';
import {
  getVehicleCargoProfile,
  type VehicleBodyType,
  type VehicleCargoProfile,
} from '../utils/vehicleCargo';

export const CargoPageBackdrop: React.FC<{ moduleId: ModuleId }> = () => {
  return null;
};

export const CargoHeroBanner: React.FC<{
  moduleId: ModuleId;
  children: React.ReactNode;
}> = ({ children }) => {
  return (
    <section className="relative overflow-hidden rounded-xl border border-slate-200/80 bg-white/95 p-6 shadow-xs backdrop-blur-md">
      <div className="relative z-10">{children}</div>
    </section>
  );
};

export const VehicleSilhouetteSvg: React.FC<{
  bodyType: VehicleBodyType;
  accentHex: string;
}> = ({ bodyType, accentHex }) => {
  if (bodyType === 'semi-reefer') {
    return (
      <svg width="26" height="16" viewBox="0 0 28 16" aria-hidden="true" className="shrink-0">
        <rect x="1" y="3" width="17" height="9" rx="1.5" fill={accentHex} fillOpacity="0.16" stroke={accentHex} strokeWidth="1.4" />
        <path d="M18 5 L23.5 5 L26 8 L26 12 L18 12 Z" fill={accentHex} />
        <rect x="20" y="6.2" width="3.5" height="2.4" rx="0.4" fill="#eff6ff" />
        <circle cx="5.5" cy="13" r="1.8" fill="#1e293b" />
        <circle cx="14" cy="13" r="1.8" fill="#1e293b" />
        <circle cx="23" cy="13" r="1.8" fill="#1e293b" />
      </svg>
    );
  }

  if (bodyType === 'sprinter-van') {
    return (
      <svg width="26" height="16" viewBox="0 0 28 16" aria-hidden="true" className="shrink-0">
        <path
          d="M2 5.5 C2 4 3 3 4.5 3 L18.5 3 C20 3 21.5 4 23 6 L25.5 7.8 C26.2 8.4 26.5 9.2 26.5 10.2 L26.5 12 L2 12 Z"
          fill={accentHex}
          fillOpacity="0.18"
          stroke={accentHex}
          strokeWidth="1.4"
        />
        <path d="M18 4.4 L21.5 6.8 L18 6.8 Z" fill={accentHex} />
        <circle cx="7" cy="13" r="1.8" fill="#1e293b" />
        <circle cx="21.5" cy="13" r="1.8" fill="#1e293b" />
      </svg>
    );
  }

  if (bodyType === 'cryo-carrier') {
    return (
      <svg width="26" height="16" viewBox="0 0 28 16" aria-hidden="true" className="shrink-0">
        <rect x="2" y="2.5" width="16" height="9.5" rx="2" fill={accentHex} fillOpacity="0.15" stroke={accentHex} strokeWidth="1.4" />
        <rect x="5" y="1" width="6" height="1.5" rx="0.5" fill={accentHex} />
        <path d="M18 4.5 L23 4.5 L25.5 7.5 L25.5 12 L18 12 Z" fill={accentHex} />
        <circle cx="7" cy="13" r="1.8" fill="#1e293b" />
        <circle cx="22" cy="13" r="1.8" fill="#1e293b" />
      </svg>
    );
  }

  // box-truck
  return (
    <svg width="26" height="16" viewBox="0 0 28 16" aria-hidden="true" className="shrink-0">
      <rect x="2" y="3" width="15" height="9" rx="1" fill={accentHex} fillOpacity="0.16" stroke={accentHex} strokeWidth="1.4" />
      <path d="M17 5 L22.5 5 L25 7.8 L25 12 L17 12 Z" fill={accentHex} />
      <circle cx="6.5" cy="13" r="1.8" fill="#1e293b" />
      <circle cx="21.5" cy="13" r="1.8" fill="#1e293b" />
    </svg>
  );
};

function renderCargoIcon(category: VehicleCargoProfile['cargoCategory']) {
  const cls = 'h-3.5 w-3.5 shrink-0';
  switch (category) {
    case 'vaccines':
      return <Syringe className={cls} />;
    case 'insulin':
      return <Droplets className={cls} />;
    case 'antibodies':
      return <FlaskConical className={cls} />;
    case 'plasma':
      return <Activity className={cls} />;
    case 'reagents':
      return <TestTube2 className={cls} />;
    case 'pediatric':
      return <ShieldPlus className={cls} />;
    case 'oncology':
      return <HeartPulse className={cls} />;
    case 'trials':
      return <Microscope className={cls} />;
    default:
      return <Package className={cls} />;
  }
}

export const VehicleCargoBadge: React.FC<{
  vehicleName: string;
  cargoType: string;
  compact?: boolean;
}> = ({ vehicleName, cargoType, compact = false }) => {
  const profile = getVehicleCargoProfile(vehicleName, cargoType);
  return (
    <div className="inline-flex items-center gap-1.5 min-w-0 max-w-full">
      <span title={profile.vehicleClassLabel} className="inline-flex items-center shrink-0">
        <VehicleSilhouetteSvg bodyType={profile.bodyType} accentHex={profile.accentHex} />
      </span>
      <span
        title={cargoType}
        className={`inline-flex items-center gap-1 rounded-md border px-1.5 py-0.5 text-[11px] font-medium shrink min-w-0 ${profile.badgeBgClass} ${profile.badgeTextClass} ${profile.badgeBorderClass}`}
      >
        <span className="shrink-0">{renderCargoIcon(profile.cargoCategory)}</span>
        <span className="truncate">{compact ? profile.cargoShortLabel : cargoType}</span>
      </span>
    </div>
  );
};

export const SignalStrengthDisplay: React.FC<{
  rssiDbm: number;
  csq?: number;
  offline?: boolean;
}> = ({ rssiDbm, csq, offline = false }) => {
  if (offline) {
    return (
      <div className="flex items-center gap-2 font-mono text-xs text-slate-500 tabular-nums whitespace-nowrap">
        <div className="flex items-end gap-0.5 h-3.5 shrink-0" aria-hidden="true">
          <span className="w-1 h-1 bg-slate-300 rounded-xs" />
          <span className="w-1 h-2 bg-slate-300 rounded-xs" />
          <span className="w-1 h-2.5 bg-slate-300 rounded-xs" />
          <span className="w-1 h-3.5 bg-slate-300 rounded-xs" />
        </div>
        <span>Offline</span>
      </div>
    );
  }

  const bars = rssiDbm >= -70 ? 4 : rssiDbm >= -82 ? 3 : rssiDbm >= -92 ? 2 : 1;
  const label =
    bars === 4 ? 'EXCELLENT' : bars === 3 ? 'GOOD' : bars === 2 ? 'FAIR' : 'WEAK';
  const colorClass =
    bars >= 3 ? 'text-emerald-700 font-semibold' : bars === 2 ? 'text-amber-700 font-semibold' : 'text-rose-700 font-semibold';
  const activeColor =
    bars >= 3 ? 'bg-emerald-600' : bars === 2 ? 'bg-amber-500' : 'bg-rose-600';

  return (
    <div className="flex items-center gap-2 font-mono text-xs tabular-nums whitespace-nowrap">
      <div className="flex items-end gap-0.5 h-3.5 shrink-0" aria-hidden="true">
        {[1, 2, 3, 4].map((level) => (
          <span
            key={level}
            className={`w-1 rounded-xs ${
              level <= bars ? activeColor : 'bg-slate-200'
            }`}
            style={{ height: `${level * 3 + 2}px` }}
          />
        ))}
      </div>
      <span className="text-slate-900 font-medium">{rssiDbm} dBm</span>
      <span className="text-slate-400">·</span>
      <span className={colorClass}>
        {label}
        {typeof csq === 'number' ? ` (CSQ ${csq})` : ''}
      </span>
    </div>
  );
};

interface OperationsDrawerProps {
  open: boolean;
  onClose: () => void;
  alerts: AlertItem[];
  activeAlertCount?: number;
  fleetRows: FleetTableRow[];
  diagnostics: DbDiagnosticsPayload | null;
  onUpdateAlertStatus: (alertId: string, status: AlertStatus) => Promise<void>;
  onFocusVehicle: (deviceId: string) => void;
  onRunBenchmark: () => Promise<void>;
}

function urlBase64ToUint8Array(base64String: string) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  const outputArray = new Uint8Array(rawData.length);
  for (let i = 0; i < rawData.length; ++i) {
    outputArray[i] = rawData.charCodeAt(i);
  }
  return outputArray;
}

async function safeFetchJson(url: string, options: RequestInit = {}) {
  const headers = {
    'ngrok-skip-browser-warning': 'true',
    ...(options.headers || {}),
  };
  const res = await fetch(url, { ...options, headers });
  const text = await res.text();
  try {
    return { ok: res.ok, status: res.status, data: JSON.parse(text) };
  } catch {
    return { ok: false, status: res.status, data: { detail: text.slice(0, 150) } };
  }
}

export const OperationsDrawer: React.FC<OperationsDrawerProps> = ({
  open,
  onClose,
  alerts,
  activeAlertCount,
  fleetRows,
  diagnostics,
  onUpdateAlertStatus,
  onFocusVehicle,
  onRunBenchmark,
}) => {
  const [tab, setTab] = useState<'alerts' | 'mobile_alerts'>('alerts');
  const [statusFilter, setStatusFilter] = useState<'ALL' | AlertStatus>('ALL');
  const [busyId, setBusyId] = useState<string | null>(null);

  // Mobile Push State
  const [mobiles, setMobiles] = useState<Array<{
    id: number;
    phone_number: string;
    recipient_name: string;
    device_name: string;
    channel: string;
    has_webpush?: boolean;
    notify_temperature: boolean;
    notify_door: boolean;
    notify_tamper: boolean;
    notify_offline: boolean;
    is_active: boolean;
    created_at_ms: number;
    last_notified_at_ms?: number | null;
  }>>([]);
  const [loadingMobiles, setLoadingMobiles] = useState(false);
  const [regPhone, setRegPhone] = useState('');
  const [regName, setRegName] = useState('Fleet Operations');
  const [regDevice, setRegDevice] = useState(
    typeof navigator !== 'undefined' && /Mobi|Android/i.test(navigator.userAgent)
      ? 'Android Mobile'
      : typeof navigator !== 'undefined' && /iPhone|iPad/i.test(navigator.userAgent)
        ? 'iPhone'
        : 'Operations Station'
  );
  const [submitting, setSubmitting] = useState(false);
  const [testResult, setTestResult] = useState<string | null>(null);
  const [isDeviceSubscribed, setIsDeviceSubscribed] = useState(false);
  const [devicePushLoading, setDevicePushLoading] = useState(false);

  const checkDeviceSubscription = async () => {
    if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      setIsDeviceSubscribed(!!sub);
    } catch (e) {}
  };

  const fetchMobiles = async () => {
    setLoadingMobiles(true);
    try {
      const res = await safeFetchJson('/api/v1/notifications/mobiles');
      if (res.ok && res.data.mobiles) {
        setMobiles(res.data.mobiles);
      }
    } catch (e) {
      console.error(e);
    } finally {
      setLoadingMobiles(false);
    }
  };

  useEffect(() => {
    if (open) {
      fetchMobiles();
      checkDeviceSubscription();
    }
  }, [open]);

  const handleEnableDevicePush = async () => {
    setDevicePushLoading(true);
    setTestResult(null);
    try {
      if (typeof window === 'undefined' || !('serviceWorker' in navigator) || !('PushManager' in window)) {
        throw new Error('Push notifications are not supported by this browser.');
      }
      const perm = await Notification.requestPermission();
      if (perm !== 'granted') {
        throw new Error('Notification permission was dismissed or denied.');
      }

      let reg = await navigator.serviceWorker.getRegistration();
      if (!reg) {
        reg = await navigator.serviceWorker.register('/sw.js');
      }
      const readyReg = await navigator.serviceWorker.ready;

      // Fetch VAPID public key
      const keyRes = await safeFetchJson('/api/v1/notifications/vapid-public-key');
      if (!keyRes.ok || !keyRes.data?.public_key) {
        throw new Error('VAPID public key unavailable from server.');
      }

      const appServerKey = urlBase64ToUint8Array(keyRes.data.public_key);
      const sub = await readyReg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: appServerKey,
      });

      const isMobile = /Android|iPhone|iPad|iPod/i.test(navigator.userAgent);
      const devLabel = isMobile
        ? /iPhone|iPad/i.test(navigator.userAgent)
          ? 'Apple iPhone'
          : 'Android Mobile'
        : 'Desktop Browser';

      const subRes = await safeFetchJson('/api/v1/notifications/webpush/subscribe', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          push_subscription: sub.toJSON(),
          recipient_name: 'Primary Mobile Operator',
          device_name: `${devLabel} (${navigator.platform || 'Online'})`,
          channel: 'native_webpush',
          notify_temperature: true,
          notify_door: true,
          notify_tamper: true,
          notify_offline: true,
        }),
      });

      if (!subRes.ok) {
        throw new Error(subRes.data?.detail || 'Failed to register subscription.');
      }

      setIsDeviceSubscribed(true);
      setTestResult('Lock-screen alerts activated on this phone. Sending test ping...');
      await fetchMobiles();

      // Trigger test push
      await safeFetchJson('/api/v1/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push_subscription: sub.toJSON() }),
      });
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    } finally {
      setDevicePushLoading(false);
    }
  };

  const handleDisableDevicePush = async () => {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await sub.unsubscribe();
      }
      setIsDeviceSubscribed(false);
      setTestResult('Lock-screen notifications disabled for this device.');
      fetchMobiles();
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    }
  };

  const handleSendTestToCurrentDevice = async () => {
    setTestResult('Sending test push to this device...');
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (!sub) {
        throw new Error('Device is not subscribed.');
      }
      const res = await safeFetchJson('/api/v1/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ push_subscription: sub.toJSON() }),
      });
      if (res.ok) {
        setTestResult(res.data?.message || 'Test push delivered to your device lock screen.');
      } else {
        setTestResult(`Error: ${res.data?.detail || res.data?.message || 'Dispatch failed'}`);
      }
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    }
  };

  const handleRegisterMobile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!regPhone || regPhone.trim().length < 7) {
      alert('Please enter a valid phone number (at least 7 digits)');
      return;
    }
    setSubmitting(true);
    setTestResult(null);

    try {
      const res = await safeFetchJson('/api/v1/notifications/register', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          phone_number: regPhone.trim(),
          recipient_name: regName.trim(),
          device_name: regDevice.trim(),
          channel: 'web_push',
          notify_temperature: true,
          notify_door: true,
          notify_tamper: true,
          notify_offline: true,
        }),
      });
      if (res.ok) {
        setTestResult(`Registered ${regPhone.trim()}. Sending verification alert...`);
        const phoneToTest = regPhone.trim();
        setRegPhone('');
        await fetchMobiles();
        handleSendTestPush(phoneToTest);
      } else {
        setTestResult(`Error: ${res.data?.detail || 'Registration failed'}`);
      }
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    } finally {
      setSubmitting(false);
    }
  };

  const handleSendTestPush = async (phone: string, sub?: any) => {
    setTestResult(`Sending test alert to ${phone}...`);
    try {
      const res = await safeFetchJson('/api/v1/notifications/test', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone_number: phone, push_subscription: sub }),
      });
      if (res.ok) {
        setTestResult(res.data?.message || `Test alert delivered to ${phone}.`);
      } else {
        setTestResult(`Error: ${res.data?.detail || res.data?.message || 'Dispatch failed'}`);
      }
    } catch (err: any) {
      setTestResult(`Error: ${err.message}`);
    }
  };

  const handleDeleteMobile = async (phone: string) => {
    if (!confirm(`Unlink phone ${phone}?`)) return;
    try {
      await safeFetchJson(`/api/v1/notifications/mobiles/${encodeURIComponent(phone)}`, { method: 'DELETE' });
      fetchMobiles();
    } catch (e) {}
  };

  const filteredAlerts = useMemo(
    () =>
      alerts.filter((a) =>
        statusFilter === 'ALL' ? true : a.status === statusFilter
      ),
    [alerts, statusFilter]
  );

  if (!open) return null;

  const handleStatus = async (alertId: string, next: AlertStatus) => {
    setBusyId(alertId);
    try {
      await onUpdateAlertStatus(alertId, next);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-slate-900/35 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-label="Fleet Alerts and Mobile Push Notifications"
    >
      <div className="flex h-full w-full max-w-xl flex-col border-l border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-4">
            <h2 className="font-display text-base font-bold text-slate-900">
              Operations Console
            </h2>
            <div className="flex items-center rounded-lg border border-slate-200 bg-slate-100 p-0.5 text-xs">
              <button
                type="button"
                onClick={() => setTab('alerts')}
                className={`rounded-md px-3 py-1 font-medium transition-colors cursor-pointer ${
                  tab === 'alerts'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                Alerts ({activeAlertCount !== undefined ? activeAlertCount : alerts.filter((a) => a.status === 'Active').length})
              </button>
              <button
                type="button"
                onClick={() => setTab('mobile_alerts')}
                className={`rounded-md px-3 py-1 font-medium transition-colors cursor-pointer flex items-center gap-1.5 ${
                  tab === 'mobile_alerts'
                    ? 'bg-blue-600 text-white shadow-xs'
                    : 'text-slate-600 hover:text-slate-900'
                }`}
              >
                <Smartphone className="h-3.5 w-3.5" />
                Mobile Push Alerts ({mobiles.length})
              </button>
            </div>
          </div>

          <button
            type="button"
            onClick={onClose}
            aria-label="Close console drawer"
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6">
          {tab === 'alerts' ? (
            <div className="space-y-4">
              <div className="flex items-center justify-between gap-2">
                <span className="text-xs text-slate-600">
                  {filteredAlerts.length} incidents across {fleetRows.length} vehicles
                </span>
                <select
                  value={statusFilter}
                  onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)}
                  aria-label="Filter alerts by status"
                  className="h-8 rounded-lg border border-slate-200 bg-white px-2.5 text-xs text-slate-800 cursor-pointer"
                >
                  <option value="ALL">All Statuses</option>
                  <option value="Active">Active</option>
                  <option value="Acknowledged">Acknowledged</option>
                  <option value="Resolved">Resolved</option>
                </select>
              </div>

              <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-slate-50/70">
                {filteredAlerts.length === 0 ? (
                  <div className="p-8 text-center text-xs text-slate-500">
                    No active or historical alerts matching filter.
                  </div>
                ) : (
                  filteredAlerts.map((alert) => (
                    <div key={alert.alert_id} className="p-4 space-y-2">
                      <div className="flex items-center justify-between gap-2 text-xs">
                        <div className="flex items-center gap-2 font-mono">
                          <span
                            className={`font-semibold ${
                              alert.severity === 'CRITICAL'
                                ? 'text-rose-600'
                                : alert.severity === 'HIGH'
                                  ? 'text-amber-600'
                                  : 'text-slate-700'
                            }`}
                          >
                            {alert.severity}
                          </span>
                          <span className="text-slate-400">·</span>
                          <button
                            type="button"
                            onClick={() => {
                              onFocusVehicle(alert.device_id);
                              onClose();
                            }}
                            className="font-semibold text-blue-600 hover:underline cursor-pointer"
                          >
                            {alert.device_id}
                          </button>
                          <span className="text-slate-400">·</span>
                          <span className="text-slate-800 font-sans font-medium">
                            {alert.alert_type}
                          </span>
                        </div>
                        <span className="font-mono text-[11px] text-slate-500 tabular-nums">
                          {alert.time_str}
                        </span>
                      </div>

                      <p className="text-sm text-slate-900 font-medium">{alert.message}</p>
                      <p className="text-xs text-slate-600">{alert.ai_analysis}</p>

                      <div className="flex items-center justify-between pt-1">
                        <span className="font-mono text-[11px] text-slate-500">
                          Status: {alert.status} · {alert.alert_id}
                        </span>
                        <div className="flex items-center gap-2">
                          {alert.status === 'Active' && (
                            <button
                              type="button"
                              disabled={busyId === alert.alert_id}
                              onClick={() => handleStatus(alert.alert_id, 'Acknowledged')}
                              className="inline-flex items-center gap-1 rounded-md border border-amber-300 bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-800 hover:bg-amber-100 cursor-pointer"
                            >
                              <Check className="h-3.5 w-3.5" /> Acknowledge
                            </button>
                          )}
                          {alert.status !== 'Resolved' && (
                            <button
                              type="button"
                              disabled={busyId === alert.alert_id}
                              onClick={() => handleStatus(alert.alert_id, 'Resolved')}
                              className="inline-flex items-center gap-1 rounded-md border border-emerald-300 bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800 hover:bg-emerald-100 cursor-pointer"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" /> Resolve
                            </button>
                          )}
                        </div>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </div>
          ) : (
            /* TAB 2: Zero-Cost Mobile Push Alerts */
            <div className="space-y-5">
              {/* 1-CLICK NATIVE DEVICE PUSH CARD */}
              {isDeviceSubscribed ? (
                <div className="rounded-xl border border-emerald-300 bg-emerald-50/80 p-4 space-y-3">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <span className="flex h-2.5 w-2.5 rounded-full bg-emerald-500 animate-pulse" />
                      <span className="text-xs font-bold text-emerald-950">Lock-Screen Alerts Active on This Device</span>
                    </div>
                    <span className="rounded-md bg-emerald-200/60 px-2 py-0.5 text-[10px] font-bold text-emerald-800">
                      W3C Native Push
                    </span>
                  </div>
                  <p className="text-xs text-emerald-800 leading-relaxed">
                    This browser is directly connected to live telemetry. Critical temperature excursions, bay door breaches, and probe disconnects will ring your screen automatically.
                  </p>
                  <div className="flex items-center gap-2 pt-1">
                    <button
                      type="button"
                      onClick={handleSendTestToCurrentDevice}
                      className="inline-flex items-center gap-1.5 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-semibold text-white hover:bg-emerald-700 cursor-pointer shadow-xs"
                    >
                      <Bell className="h-3.5 w-3.5" />
                      Send Test Alert to This Device
                    </button>
                    <button
                      type="button"
                      onClick={handleDisableDevicePush}
                      className="text-xs text-emerald-700 hover:text-emerald-900 hover:underline cursor-pointer px-2 py-1"
                    >
                      Turn Off
                    </button>
                  </div>
                </div>
              ) : (
                <div className="rounded-xl border border-blue-200 bg-blue-50/80 p-4 space-y-3 shadow-2xs">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-xs font-bold text-blue-950">
                      <Smartphone className="h-4 w-4 text-blue-600" />
                      <span>Native Device Push Alerts</span>
                    </div>
                    <span className="rounded-md bg-blue-100 px-2 py-0.5 text-[10px] font-bold text-blue-700">
                      W3C Push API
                    </span>
                  </div>
                  <p className="text-xs text-blue-800 leading-relaxed">
                    Subscribe to receive instant lock-screen notifications directly on this device for temperature excursions and door breaches.
                  </p>
                  <button
                    type="button"
                    disabled={devicePushLoading}
                    onClick={handleEnableDevicePush}
                    className="w-full flex items-center justify-center gap-2 rounded-lg bg-blue-600 px-4 py-2.5 text-xs font-bold text-white hover:bg-blue-700 transition-colors cursor-pointer disabled:opacity-50"
                  >
                    <Bell className="h-4 w-4" />
                    {devicePushLoading ? 'Connecting Device...' : 'Enable Lock-Screen Alerts on This Device'}
                  </button>
                </div>
              )}

              {/* QR Code to Pair Physical Mobile Phone (Shown on PC/Desktop only) */}
              {typeof navigator !== 'undefined' && !/Android|iPhone|iPad|iPod/i.test(navigator.userAgent) && (
                <div className="rounded-xl border border-slate-200 bg-slate-50/70 p-4 space-y-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-900">
                    <Smartphone className="h-4 w-4 text-slate-700" />
                    <span>How to Get Alerts on Your Physical Mobile Phone:</span>
                  </div>
                  <div className="flex flex-col sm:flex-row items-center gap-4">
                    <div className="shrink-0 bg-white p-2 rounded-lg border border-slate-200 shadow-2xs">
                      <img
                        src={`https://api.qrserver.com/v1/create-qr-code/?size=120x120&data=${encodeURIComponent(typeof window !== 'undefined' ? window.location.origin : 'https://tipper-compost-fantasize.ngrok-free.dev')}`}
                        alt="Scan to open on mobile"
                        className="w-24 h-24"
                      />
                    </div>
                    <div className="text-xs text-slate-800 space-y-1.5 leading-relaxed">
                      <p className="font-semibold text-slate-900">
                        1. Open your mobile phone camera and scan this QR code.
                      </p>
                      <p>
                        2. When the dashboard opens in your phone's Chrome or Safari, tap <strong>Alerts</strong> &rarr; <strong>Mobile Push Alerts</strong>.
                      </p>
                      <p>
                        3. Tap <strong>"Enable Lock-Screen Alerts on This Phone"</strong> and select <strong>"Allow"</strong>.
                      </p>
                      <p className="text-[11px] text-emerald-800 font-medium pt-0.5">
                        Your phone hardware will be paired to receive alarms whenever GW-001 has a temperature excursion or door breach.
                      </p>
                    </div>
                  </div>
                </div>
              )}

              {/* Status Banner */}
              {testResult && (
                <div className={`rounded-lg p-3 text-xs font-medium ${!testResult.startsWith('Error') ? 'bg-emerald-50 text-emerald-800 border border-emerald-300' : 'bg-rose-50 text-rose-800 border border-rose-300'}`}>
                  {testResult}
                </div>
              )}

              {/* Mobile Phone Registration Form */}
              <form onSubmit={handleRegisterMobile} className="rounded-xl border border-slate-200 bg-slate-50/80 p-4 space-y-3">
                <div className="text-xs font-bold text-slate-900 flex items-center justify-between">
                  <span>Register Mobile Phone</span>
                  <span className="text-[10px] font-normal text-slate-500 font-mono">Instant W3C Web Push</span>
                </div>

                <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Mobile Number (with country code)
                    </label>
                    <input
                      type="tel"
                      required
                      placeholder="+91 9876543210"
                      value={regPhone}
                      onChange={(e) => setRegPhone(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 placeholder:text-slate-400 focus:border-blue-600 focus:outline-hidden"
                    />
                  </div>

                  <div>
                    <label className="block text-[11px] font-semibold text-slate-700 mb-1">
                      Recipient / Role Name
                    </label>
                    <input
                      type="text"
                      required
                      placeholder="e.g. Lead QA / Fleet Manager"
                      value={regName}
                      onChange={(e) => setRegName(e.target.value)}
                      className="w-full rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-xs text-slate-900 focus:border-blue-600 focus:outline-hidden"
                    />
                  </div>
                </div>

                <div className="flex items-center justify-between gap-3 pt-1">
                  <div className="flex items-center gap-1.5 text-[11px] text-slate-600">
                    <Bell className="h-3.5 w-3.5 text-emerald-600" />
                    <span>Triggers: Temp Excursion, Door, Tamper, Offline</span>
                  </div>
                  <button
                    type="submit"
                    disabled={submitting}
                    className="inline-flex items-center gap-1.5 rounded-lg bg-blue-600 px-3.5 py-1.5 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer disabled:opacity-50"
                  >
                    <Send className="h-3 w-3" />
                    {submitting ? 'Registering...' : 'Register Mobile'}
                  </button>
                </div>
              </form>

              {/* Registered Phones Table */}
              <div className="space-y-2">
                <div className="flex items-center justify-between text-xs font-semibold text-slate-900">
                  <span>Registered Mobile Recipients ({mobiles.length})</span>
                  <button
                    type="button"
                    onClick={fetchMobiles}
                    className="text-[11px] text-blue-600 hover:underline cursor-pointer"
                  >
                    Refresh
                  </button>
                </div>

                {loadingMobiles ? (
                  <div className="p-4 text-center text-xs text-slate-500">Loading mobile devices...</div>
                ) : mobiles.length === 0 ? (
                  <div className="rounded-lg border border-dashed border-slate-300 p-6 text-center text-xs text-slate-500 space-y-1">
                    <p className="font-semibold text-slate-700">No mobile phones registered yet.</p>
                    <p>Enter your phone number above and click Register to enable lock-screen notifications.</p>
                  </div>
                ) : (
                  <div className="divide-y divide-slate-200 rounded-xl border border-slate-200 bg-white">
                    {mobiles.map((m) => (
                      <div key={m.id} className="p-3.5 flex items-center justify-between gap-3 text-xs">
                        <div className="min-w-0 space-y-0.5">
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-bold text-slate-900">{m.phone_number}</span>
                            <span className="rounded bg-emerald-50 px-1.5 py-0.2 text-[10px] font-bold text-emerald-700 border border-emerald-200">
                              ● ACTIVE
                            </span>
                          </div>
                          <div className="text-[11px] text-slate-500 truncate">
                            {m.recipient_name} · {m.device_name}
                            {m.last_notified_at_ms && (
                              <span> · Last alert: {new Date(m.last_notified_at_ms).toLocaleTimeString()}</span>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          <button
                            type="button"
                            onClick={() => handleSendTestPush(m.phone_number, (m as any).push_subscription)}
                            className="inline-flex items-center gap-1 rounded-md border border-blue-200 bg-blue-50 px-2.5 py-1 text-[11px] font-semibold text-blue-700 hover:bg-blue-100 cursor-pointer"
                            title="Sends an instant test alert to this phone"
                          >
                            <Volume2 className="h-3 w-3" /> Test Alert
                          </button>
                          <button
                            type="button"
                            onClick={() => handleDeleteMobile(m.phone_number)}
                            className="rounded-md border border-slate-200 p-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600 cursor-pointer"
                            title="Unlink phone"
                          >
                            <Trash2 className="h-3.5 w-3.5" />
                          </button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Step-by-Step Mobile Setup Guide */}
              <div className="rounded-xl border border-slate-200 bg-slate-50 p-4 space-y-2 text-xs text-slate-700">
                <div className="font-bold text-slate-900 flex items-center gap-1.5">
                  <Info className="h-3.5 w-3.5 text-blue-600" />
                  <span>How to Receive Lock Screen Alarms on Your Phone</span>
                </div>
                <ul className="list-disc pl-4 space-y-1 text-[11px] text-slate-600">
                  <li><strong>Android (Chrome / Edge / Samsung)</strong>: Simply tap <em>Register Mobile</em> on your phone and tap <em>Allow</em> when Chrome prompts for notifications.</li>
                  <li><strong>iPhone / iOS (Safari)</strong>: Open the dashboard URL in Safari, tap <em>Share</em> (box with arrow) → tap <em>Add to Home Screen</em>, then open the app from your home screen and enable alerts.</li>
                  <li><strong>Free Emergency Siren (ntfy.sh)</strong>: You can also install the free open-source <em>ntfy</em> app from Google Play or App Store and subscribe to your number's topic for custom emergency sirens.</li>
                </ul>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
