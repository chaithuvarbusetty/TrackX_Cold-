import React from 'react';
import type { ModuleId } from '../shared/types';

interface TopNavbarProps {
  activeModule: ModuleId;
  onSelectModule: (mod: ModuleId) => void;
  activeAlertCount: number;
  onOpenAlertsDrawer: () => void;
}

const NAV_ITEMS: Array<{ id: ModuleId; label: string }> = [
  { id: 'live-tracking', label: 'Live Tracking' },
  { id: 'thermal-status', label: 'Thermal Status' },
  { id: 'vehicle-readings', label: 'Vehicle Monitoring' },
  { id: 'trips', label: 'Trips' },
  { id: 'twin-world', label: '3D Twin World' },
  { id: 'help', label: 'Help' },
];

export const TopNavbar: React.FC<TopNavbarProps> = ({
  activeModule,
  onSelectModule,
  activeAlertCount,
  onOpenAlertsDrawer,
}) => {
  return (
    <header className="sticky top-0 z-40 border-b border-slate-200 bg-white shadow-2xs">
      <div className="mx-auto flex h-16 max-w-[1440px] items-center justify-between gap-8 px-6">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => onSelectModule('live-tracking')}
          className="font-display text-lg font-bold tracking-tight text-slate-900 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-blue-600"
        >
          ColdChain
        </button>

        {/* Zone 2: 5 Clean Single-Line Navigation Links (Help is strictly last) */}
        <nav
          aria-label="Primary pages"
          className="flex items-center gap-6 overflow-x-auto"
        >
          {NAV_ITEMS.map((item) => {
            const isActive = activeModule === item.id;
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSelectModule(item.id)}
                className={`relative py-5 text-sm font-medium transition-colors duration-150 whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-blue-600 ${
                  isActive
                    ? 'text-blue-700 font-semibold'
                    : 'text-slate-600 hover:text-slate-950'
                }`}
              >
                {item.label}
                {isActive && (
                  <span
                    aria-hidden="true"
                    className="absolute inset-x-0 bottom-0 h-0.5 bg-blue-600"
                  />
                )}
              </button>
            );
          })}
        </nav>

        {/* Zone 3: Single Primary Action */}
        <div className="flex items-center gap-2.5 shrink-0">
          <a
            href="/logs"
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1.5 rounded-lg border border-cyan-300 bg-cyan-50 px-3 py-1.5 text-xs font-semibold text-cyan-800 transition-colors duration-150 hover:bg-cyan-100 whitespace-nowrap shrink-0"
          >
            <span className="h-2 w-2 rounded-full bg-cyan-500 animate-pulse"></span>
            Hardware Console
          </a>
          <button
            type="button"
            onClick={onOpenAlertsDrawer}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white transition-colors duration-150 hover:bg-blue-700 whitespace-nowrap shrink-0 cursor-pointer tabular-nums focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-500"
          >
            {activeAlertCount > 0 ? `Alerts (${activeAlertCount})` : 'Alerts'}
          </button>
        </div>
      </div>
    </header>
  );
};
