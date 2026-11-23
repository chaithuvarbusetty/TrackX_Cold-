import React from 'react';
import { X, ShieldCheck, FileText } from 'lucide-react';

interface LegalModalProps {
  open: boolean;
  onClose: () => void;
}

export const PrivacyPolicyModal: React.FC<LegalModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="privacy-modal-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <ShieldCheck className="h-5 w-5 text-blue-600" />
            <h2 id="privacy-modal-title" className="font-display text-base font-bold text-slate-900">
              Privacy Policy - Telemetry &amp; Custody Data
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs leading-relaxed text-slate-600">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">1. Scope and Custody Telemetry</h3>
            <p>
              This enterprise platform monitors refrigerated logistics assets, continuous cargo chamber temperatures, and cellular gateway telemetry for pharmaceutical cold-chain integrity. Telemetry data is recorded exclusively for Good Distribution Practice (GDP) verification, cargo safety audits, and regulatory custody reporting.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">2. Zero Third-Party Tracking</h3>
            <p>
              The platform does not deploy third-party advertising cookies, cross-site tracking pixels, or commercial behavioral trackers. Session identifiers and client cache state exist solely to sustain live WebSocket telemetry streams and encrypted operational state.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">3. Real-Time Geolocation Data</h3>
            <p>
              Vehicle GPS coordinates, headings, and waypoint corridors are ingested strictly from authorized hardware gateways (Quectel EC200U series) bound to fleet operations. Geolocation logs are retained within high-security indexed database storage to generate RFC-4180 compliant custody manifests.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">4. Push Notification Credentials</h3>
            <p>
              Mobile and desktop alert subscriptions use W3C Push API / RFC 8030 VAPID encrypted tokens. Subscribed endpoint identifiers are utilized solely to dispatch critical thermal excursions, bay door breaches, and device health notifications to designated operational personnel.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">5. Data Retention and Compliance</h3>
            <p>
              Telemetry archives are retained in accordance with World Health Organization (WHO) Annex 5 Annexure guidelines and 21 CFR Part 11 audit requirements. Authorized operators may query historical telemetry windows and export immutable CSV audit logs at any time.
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-6 py-3 bg-slate-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
          >
            Acknowledge &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const TermsOfServiceModal: React.FC<LegalModalProps> = ({ open, onClose }) => {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 p-4 backdrop-blur-xs"
      role="dialog"
      aria-modal="true"
      aria-labelledby="terms-modal-title"
    >
      <div className="flex max-h-[85vh] w-full max-w-2xl flex-col rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-center justify-between border-b border-slate-200 px-6 py-4">
          <div className="flex items-center gap-2">
            <FileText className="h-5 w-5 text-blue-600" />
            <h2 id="terms-modal-title" className="font-display text-base font-bold text-slate-900">
              Terms &amp; Conditions - Operations SLA
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg border border-slate-200 p-1.5 text-slate-500 hover:bg-slate-100 hover:text-slate-900 cursor-pointer"
            aria-label="Close dialog"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-6 space-y-4 text-xs leading-relaxed text-slate-600">
          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">1. Authorized Operational Access</h3>
            <p>
              This operations platform is restricted to authorized fleet controllers, logistics handlers, and quality assurance release personnel. All actions, configuration changes, geofence updates, and alert acknowledgments are permanently logged in the audit ledger.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">2. Hardware Gateway Requirements</h3>
            <p>
              Continuous temperature custody relies on properly calibrated digital sensor probes and cellular hardware gateways. Operators must maintain operational battery charge, antenna clearance, and verified SIM connectivity for active transport units.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">3. Thermal Excursion Notification Protocol</h3>
            <p>
              Automated alerts reflect sensor inputs sampled at 1-second to 2-second resolution. While predictive drift algorithms flag warning trends, operators must inspect auxiliary refrigeration units and verify seal status upon alert receipt.
            </p>
          </div>

          <div>
            <h3 className="font-semibold text-slate-900 text-sm mb-1">4. Data Release &amp; Custody Integrity</h3>
            <p>
              RFC-4180 CSV exports generated from this system constitute the official thermal custody release record for audited shipments. Tampering with sensor telemetry, payload parameters, or trip bounds is strictly prohibited.
            </p>
          </div>
        </div>

        <div className="flex justify-end border-t border-slate-200 px-6 py-3 bg-slate-50 rounded-b-xl">
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg bg-blue-600 px-4 py-2 text-xs font-semibold text-white hover:bg-blue-700 cursor-pointer"
          >
            Acknowledge &amp; Close
          </button>
        </div>
      </div>
    </div>
  );
};

export const OperationsFooter: React.FC<{
  onOpenPrivacy: () => void;
  onOpenTerms: () => void;
}> = ({ onOpenPrivacy, onOpenTerms }) => {
  return (
    <footer className="mt-12 border-t border-slate-200 bg-white py-6 text-xs text-slate-500">
      <div className="mx-auto flex max-w-[1440px] flex-col items-center justify-between gap-4 px-6 sm:flex-row">
        <div className="flex items-center gap-3">
          <span className="font-bold text-slate-900">ColdChain Operations</span>
          <span className="text-slate-300">|</span>
          <span>Enterprise Logistics &amp; Thermal Custody Platform</span>
        </div>

        <div className="flex items-center gap-6">
          <button
            type="button"
            onClick={onOpenPrivacy}
            className="hover:text-blue-700 hover:underline cursor-pointer transition-colors"
          >
            Privacy Policy
          </button>
          <span className="text-slate-300">|</span>
          <button
            type="button"
            onClick={onOpenTerms}
            className="hover:text-blue-700 hover:underline cursor-pointer transition-colors"
          >
            Terms &amp; Conditions
          </button>
          <span className="text-slate-300">|</span>
          <span className="font-mono text-[11px] text-slate-400">PostgreSQL 16 Engine</span>
        </div>
      </div>
    </footer>
  );
};
