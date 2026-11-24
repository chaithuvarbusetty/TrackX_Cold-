import React from 'react';
import { Smartphone, X, AlertTriangle, ShieldAlert, Car, Trash2, CheckCircle2 } from 'lucide-react';
import { PhoneAlertMessage } from '../types/cargoguard';

interface DriverPhoneDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  alerts: PhoneAlertMessage[];
  onDismissAlert: (id: number) => void;
  onClearAll: () => void;
}

export const DriverPhoneDrawer: React.FC<DriverPhoneDrawerProps> = ({
  isOpen,
  onClose,
  alerts,
  onDismissAlert,
  onClearAll,
}) => {
  if (!isOpen) return null;

  return (
    <div className="fixed inset-y-0 right-0 z-50 flex items-center justify-end p-4 pointer-events-none">
      <div className="pointer-events-auto relative w-80 sm:w-88 rounded-[38px] border-[6px] border-slate-900 bg-slate-950 p-3 shadow-2xl text-white overflow-hidden flex flex-col max-h-[85vh] animate-in slide-in-from-right-4 duration-200">
        {/* Dynamic Island / Speaker Notch */}
        <div className="flex justify-center mb-2 shrink-0">
          <div className="h-4 w-28 rounded-full bg-slate-900 flex items-center justify-center">
            <div className="h-2 w-2 rounded-full bg-slate-800 mr-2" />
            <div className="h-1.5 w-8 rounded-full bg-slate-800" />
          </div>
        </div>

        {/* Phone Status Bar */}
        <div className="flex items-center justify-between px-3 text-[11px] font-mono text-slate-400 mb-2 shrink-0">
          <span>9:41 AM</span>
          <div className="flex items-center gap-1.5">
            <span className="text-[10px]">5G</span>
            <span>98%</span>
            <button
              onClick={onClose}
              className="ml-2 rounded-full p-1 text-slate-400 hover:text-white hover:bg-slate-800 cursor-pointer"
              title="Close Phone Drawer"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        {/* Lock Screen Header */}
        <div className="px-3 pb-2 border-b border-white/10 shrink-0 flex items-center justify-between">
          <div>
            <div className="text-xs font-semibold text-slate-200 flex items-center gap-1.5">
              <Smartphone className="h-3.5 w-3.5 text-blue-400" />
              <span>Driver Emergency Unit</span>
            </div>
            <div className="text-[10px] text-slate-400">ColdChain Telemetry Push</div>
          </div>
          {alerts.length > 0 && (
            <button
              onClick={onClearAll}
              className="text-[10px] text-slate-400 hover:text-red-400 flex items-center gap-1 px-1.5 py-0.5 rounded hover:bg-slate-900 cursor-pointer transition-colors"
            >
              <Trash2 className="h-3 w-3" />
              <span>Clear</span>
            </button>
          )}
        </div>

        {/* Notifications List */}
        <div className="flex-1 overflow-y-auto py-2.5 px-1 space-y-2">
          {alerts.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-10 text-center px-4">
              <CheckCircle2 className="h-10 w-10 text-emerald-400/80 mb-2" />
              <div className="text-xs font-medium text-slate-200">All Systems Nominal</div>
              <div className="text-[11px] text-slate-500 mt-1">
                No active temperature excursions, door breaches, or hazard proximity alerts.
              </div>
            </div>
          ) : (
            alerts.map((alert) => {
              const isTemp = alert.kind === 'temp_high';
              const isDoor = alert.kind === 'door_tamper';
              const isCollision = alert.kind === 'ir_collision';

              return (
                <div
                  key={alert.id}
                  className={`p-3 rounded-2xl border text-xs shadow-md transition-all ${
                    isTemp
                      ? 'bg-red-950/70 border-red-500/50 text-red-100'
                      : isDoor
                      ? 'bg-amber-950/70 border-amber-500/50 text-amber-100'
                      : 'bg-cyan-950/70 border-cyan-500/50 text-cyan-100'
                  }`}
                >
                  <div className="flex items-start justify-between gap-1.5 mb-1">
                    <div className="flex items-center gap-1.5 font-semibold text-[11.5px]">
                      {isTemp && <AlertTriangle className="h-3.5 w-3.5 text-red-400 shrink-0" />}
                      {isDoor && <ShieldAlert className="h-3.5 w-3.5 text-amber-400 shrink-0" />}
                      {isCollision && <Car className="h-3.5 w-3.5 text-cyan-400 shrink-0" />}
                      <span>{alert.title}</span>
                    </div>
                    <button
                      onClick={() => onDismissAlert(alert.id)}
                      className="text-slate-400 hover:text-white p-0.5 rounded cursor-pointer"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  </div>
                  <p className="text-[11px] text-slate-300 leading-relaxed mb-1.5">{alert.body}</p>
                  <div className="flex items-center justify-between text-[10px] text-slate-400 font-mono">
                    <span>{alert.location}</span>
                    <span>{alert.timestamp}</span>
                  </div>
                </div>
              );
            })
          )}
        </div>

        {/* Home Bar Indicator */}
        <div className="flex justify-center pt-2 pb-1 shrink-0">
          <div className="h-1 w-24 rounded-full bg-slate-700" />
        </div>
      </div>
    </div>
  );
};
