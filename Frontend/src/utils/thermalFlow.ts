import type { FleetTableRow } from '../shared/types';

export type ThermalFlowStage = 'OPTIMAL' | 'WARNING' | 'CRITICAL' | 'OFFLINE';

export interface ThermalStandardSpec {
  id: string;
  cargo_class: string;
  maintain_min_c: number;
  maintain_max_c: number;
  ideal_setpoint_c: string;
  warning_low_c: number;
  warning_high_c: number;
  critical_low_c: number;
  critical_high_c: number;
  max_door_open_sec: number;
  excursion_budget_min: number;
  protocol_note: string;
}

export const TRANSPORT_THERMAL_STANDARDS: ThermalStandardSpec[] = [
  {
    id: 'STD-MRNA',
    cargo_class: 'mRNA Vaccines (2–8°C)',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '4.2°C ± 0.8°C',
    warning_low_c: 2.6,
    warning_high_c: 7.0,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 90,
    excursion_budget_min: 15,
    protocol_note: 'Strict WHO/GDP 2–8°C refrigerated custody; zero freeze tolerance.',
  },
  {
    id: 'STD-INSULIN',
    cargo_class: 'Insulin & Biologics',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '4.5°C ± 1.0°C',
    warning_low_c: 2.5,
    warning_high_c: 7.0,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 120,
    excursion_budget_min: 20,
    protocol_note: 'Continuous compressor duty cycle; protein denaturation if < 2.0°C.',
  },
  {
    id: 'STD-MAB',
    cargo_class: 'Monoclonal Antibodies',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '4.0°C ± 0.8°C',
    warning_low_c: 2.6,
    warning_high_c: 6.8,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 90,
    excursion_budget_min: 10,
    protocol_note: 'High thermal sensitivity; pre-alert triggers at 6.8°C upper drift.',
  },
  {
    id: 'STD-PLASMA',
    cargo_class: 'Plasma Derivatives',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '3.8°C ± 0.7°C',
    warning_low_c: 2.5,
    warning_high_c: 6.9,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 120,
    excursion_budget_min: 15,
    protocol_note: 'Maintain sealed chamber throughout transit with continuous MKT audit.',
  },
  {
    id: 'STD-REAGENT',
    cargo_class: 'Diagnostic Reagents',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '4.8°C ± 1.0°C',
    warning_low_c: 2.5,
    warning_high_c: 7.2,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 150,
    excursion_budget_min: 25,
    protocol_note: 'Verify door seal recovery within 3 minutes after depot loading.',
  },
  {
    id: 'STD-PEDIATRIC',
    cargo_class: 'Pediatric Vaccines',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '4.1°C ± 0.6°C',
    warning_low_c: 2.6,
    warning_high_c: 6.9,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 90,
    excursion_budget_min: 12,
    protocol_note: 'Freeze-sensitive VVM class; immediate alert below 2.6°C.',
  },
  {
    id: 'STD-ONCOLOGY',
    cargo_class: 'Oncology Infusions',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '5.0°C ± 0.8°C',
    warning_low_c: 2.6,
    warning_high_c: 7.0,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 90,
    excursion_budget_min: 10,
    protocol_note: 'Priority corridor dispatch; continuous telemetry signed to CSV.',
  },
  {
    id: 'STD-TRIAL',
    cargo_class: 'Clinical Trial Samples',
    maintain_min_c: 2.0,
    maintain_max_c: 8.0,
    ideal_setpoint_c: '4.4°C ± 0.8°C',
    warning_low_c: 2.5,
    warning_high_c: 7.0,
    critical_low_c: 2.0,
    critical_high_c: 8.0,
    max_door_open_sec: 60,
    excursion_budget_min: 10,
    protocol_note: '21 CFR Part 11 traceable audit log required at origin and handoff.',
  },
];

export interface ThermalFlowEvaluation {
  stage: ThermalFlowStage;
  warningHighC: number;
  warningLowC: number;
  criticalHighC: number;
  criticalLowC: number;
  reason: string;
  mitigation: string;
}

export function evaluateVehicleThermalFlow(row: FleetTableRow): ThermalFlowEvaluation {
  const criticalLow = row.target_min_c;
  const criticalHigh = row.target_max_c;
  const warningLow = Number((criticalLow + 0.6).toFixed(1));
  const warningHigh = Number((criticalHigh - 1.0).toFixed(1));

  if (row.connectivity === 'OFFLINE') {
    return {
      stage: 'OFFLINE',
      warningHighC: warningHigh,
      warningLowC: warningLow,
      criticalHighC: criticalHigh,
      criticalLowC: criticalLow,
      reason: `Gateway silent for ${row.packet_age_sec}s; last known chamber temp ${row.current_temp_c !== null && row.current_temp_c !== undefined ? row.current_temp_c.toFixed(2) + '°C' : '--.-°C'}.`,
      mitigation: 'Check 4G LTE modem heartbeat and recover buffered flash packets on reconnect.',
    };
  }

  // Handle probe standby / null digital sensor reading
  if (row.current_temp_c === null || row.current_temp_c === undefined) {
    if (row.security === 'OPEN' || row.tamper) {
      return {
        stage: 'CRITICAL',
        warningHighC: warningHigh,
        warningLowC: warningLow,
        criticalHighC: criticalHigh,
        criticalLowC: criticalLow,
        reason: row.security === 'OPEN' ? 'Rear Door OPEN' : 'Tamper Sensor Triggered',
        mitigation: 'CRITICAL ESCALATION: Verify cargo bay physical seal immediately.',
      };
    }
    return {
      stage: 'OPTIMAL',
      warningHighC: warningHigh,
      warningLowC: warningLow,
      criticalHighC: criticalHigh,
      criticalLowC: criticalLow,
      reason: 'Physical temperature sensor probe in standby / unlinked. 4G LTE gateway is online.',
      mitigation: 'Connect temperature probe (DS18B20 or BLE node) to gateway to activate thermal logging.',
    };
  }

  const curTemp = row.current_temp_c;
  if (
    curTemp > criticalHigh ||
    curTemp < criticalLow ||
    row.security === 'OPEN' ||
    row.tamper
  ) {
    const causes: string[] = [];
    if (curTemp > criticalHigh) {
      causes.push(`Temp ${curTemp.toFixed(2)}°C > Critical ${criticalHigh.toFixed(1)}°C`);
    }
    if (curTemp < criticalLow) {
      causes.push(`Temp ${curTemp.toFixed(2)}°C < Critical ${criticalLow.toFixed(1)}°C`);
    }
    if (row.security === 'OPEN') causes.push('Rear Door OPEN');
    if (row.tamper) causes.push('Tamper Sensor Triggered');

    return {
      stage: 'CRITICAL',
      warningHighC: warningHigh,
      warningLowC: warningLow,
      criticalHighC: criticalHigh,
      criticalLowC: criticalLow,
      reason: causes.join(' · '),
      mitigation: 'CRITICAL ESCALATION: Seal cargo bay, force compressor engagement, and archive CSV audit trail.',
    };
  }

  if (
    curTemp >= warningHigh ||
    curTemp <= warningLow ||
    row.excursion_risk_pct >= 35
  ) {
    const warnCause =
      curTemp >= warningHigh
        ? `Approaching upper warning (${curTemp.toFixed(2)}°C >= ${warningHigh.toFixed(1)}°C)`
        : curTemp <= warningLow
          ? `Approaching lower freeze warning (${curTemp.toFixed(2)}°C <= ${warningLow.toFixed(1)}°C)`
          : `Predicted +30m drift risk (${row.excursion_risk_pct}%)`;
    return {
      stage: 'WARNING',
      warningHighC: warningHigh,
      warningLowC: warningLow,
      criticalHighC: criticalHigh,
      criticalLowC: criticalLow,
      reason: warnCause,
      mitigation: 'PRE-ALERT: Verify evaporator airflow, monitor +30m forecast, and hold door sealed.',
    };
  }

  return {
    stage: 'OPTIMAL',
    warningHighC: warningHigh,
    warningLowC: warningLow,
    criticalHighC: criticalHigh,
    criticalLowC: criticalLow,
    reason: `Stable at ${curTemp.toFixed(2)}°C inside ${criticalLow.toFixed(1)}–${criticalHigh.toFixed(1)}°C GDP transport band.`,
    mitigation: 'Standard 1Hz telemetry logging & SQLite WAL archival active.',
  };
}
