import React, { useState } from 'react';
import type { TempTrendPoint, TemperatureForecast, TelemetryPoint } from '../shared/types';

/* 1. Inline Micro Sparkline */
export const MiniSparkline: React.FC<{
  values: (number | null)[];
  color?: string;
  height?: number;
}> = ({ values, color = '#2563eb', height = 22 }) => {
  const cleanValues = (values || []).filter((v): v is number => v !== null && v !== undefined && !isNaN(v));
  if (cleanValues.length < 2) {
    return <div style={{ height }} className="w-16 font-mono text-[9px] text-slate-400 flex items-center">Standby</div>;
  }
  const w = 72;
  const min = Math.min(...cleanValues, 2);
  const max = Math.max(...cleanValues, 8);
  const span = Math.max(0.5, max - min);
  const pts = cleanValues
    .map((v, idx) => {
      const x = (idx / (cleanValues.length - 1)) * w;
      const y = height - 2 - ((v - min) / span) * (height - 4);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    })
    .join(' ');

  return (
    <svg width={w} height={height} className="overflow-visible shrink-0" aria-hidden="true">
      <polyline
        fill="none"
        stroke={color}
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={pts}
      />
    </svg>
  );
};

/* 2. 24-Hour Fleet Thermal Overview (Zero-Flicker Interactive SVG) */
export const Temp24hChart: React.FC<{ data: TempTrendPoint[] }> = ({ data }) => {
  const [hoverIdx, setHoverIdx] = useState<number | null>(null);

  if (!data || data.length === 0) {
    return (
      <div className="flex h-52 items-center justify-center text-xs text-slate-500">
        Aggregating 24h temperature rollup...
      </div>
    );
  }

  const width = 620;
  const height = 210;
  const padL = 38;
  const padR = 14;
  const padT = 16;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const yMin = 0;
  const yMax = Math.max(10.5, ...data.map((d) => d.max_temp_c + 0.8));

  const xPos = (i: number) =>
    padL + (data.length === 1 ? innerW / 2 : (i / (data.length - 1)) * innerW);
  const yPos = (val: number) =>
    padT + innerH - ((val - yMin) / (yMax - yMin)) * innerH;

  const avgLine = data
    .map((d, i) => `${xPos(i).toFixed(1)},${yPos(d.avg_temp_c).toFixed(1)}`)
    .join(' ');

  const bandPolygon = [
    ...data.map((d, i) => `${xPos(i).toFixed(1)},${yPos(d.max_temp_c).toFixed(1)}`),
    ...data
      .slice()
      .reverse()
      .map((d, revIdx) => {
        const i = data.length - 1 - revIdx;
        return `${xPos(i).toFixed(1)},${yPos(d.min_temp_c).toFixed(1)}`;
      }),
  ].join(' ');

  const safeTop = yPos(8.0);
  const safeBot = yPos(2.0);
  const activePoint = hoverIdx !== null ? data[hoverIdx] : null;

  return (
    <div className="relative w-full">
      <svg
        viewBox={`0 0 ${width} ${height}`}
        className="h-52 w-full select-none"
        onMouseLeave={() => setHoverIdx(null)}
      >
        {/* Safe Band 2°C - 8°C */}
        <rect
          x={padL}
          y={safeTop}
          width={innerW}
          height={Math.max(0, safeBot - safeTop)}
          fill="rgba(16, 185, 129, 0.08)"
        />
        <line
          x1={padL}
          y1={safeTop}
          x2={width - padR}
          y2={safeTop}
          stroke="rgba(225, 29, 72, 0.5)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />
        <line
          x1={padL}
          y1={safeBot}
          x2={width - padR}
          y2={safeBot}
          stroke="rgba(37, 99, 235, 0.4)"
          strokeDasharray="4 4"
          strokeWidth="1"
        />

        {/* Y Grid */}
        {[2, 4, 6, 8, 10].map((tick) => {
          const y = yPos(tick);
          return (
            <g key={tick}>
              <line
                x1={padL}
                y1={y}
                x2={width - padR}
                y2={y}
                stroke="rgba(148, 163, 184, 0.25)"
              />
              <text
                x={padL - 6}
                y={y + 3}
                textAnchor="end"
                className="fill-slate-600 text-[10px] font-mono"
              >
                {tick}°
              </text>
            </g>
          );
        })}

        {/* Min-Max Envelope */}
        <polygon points={bandPolygon} fill="rgba(37, 99, 235, 0.14)" />

        {/* Avg Polyline */}
        <polyline
          fill="none"
          stroke="#2563eb"
          strokeWidth="2.2"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={avgLine}
        />

        {/* X Labels */}
        {data.map((d, i) => {
          const step = Math.max(1, Math.floor(data.length / 6));
          if (i % step !== 0 && i !== data.length - 1) return null;
          return (
            <text
              key={`${d.label}-${i}`}
              x={xPos(i)}
              y={height - 6}
              textAnchor="middle"
              className="fill-slate-600 text-[10px] font-mono"
            >
              {d.label}
            </text>
          );
        })}

        {/* Hover targets */}
        {data.map((d, i) => (
          <rect
            key={`hit-${i}`}
            x={xPos(i) - innerW / Math.max(2, data.length * 2)}
            y={padT}
            width={innerW / Math.max(1, data.length)}
            height={innerH}
            fill="transparent"
            onMouseEnter={() => setHoverIdx(i)}
          />
        ))}

        {hoverIdx !== null && activePoint && (
          <g>
            <line
              x1={xPos(hoverIdx)}
              y1={padT}
              x2={xPos(hoverIdx)}
              y2={padT + innerH}
              stroke="rgba(37, 99, 235, 0.55)"
              strokeDasharray="3 3"
            />
            <circle
              cx={xPos(hoverIdx)}
              cy={yPos(activePoint.avg_temp_c)}
              r="4"
              fill="#2563eb"
              stroke="#ffffff"
              strokeWidth="2"
            />
          </g>
        )}
      </svg>

      {activePoint && (
        <div className="pointer-events-none absolute right-3 top-2 rounded-lg border border-slate-200 bg-white/95 px-2.5 py-1.5 text-[11px] font-mono shadow-md">
          <div className="font-semibold text-slate-900">{activePoint.label} Bucket</div>
          <div className="text-blue-600">Avg: {activePoint.avg_temp_c.toFixed(2)}°C</div>
          <div className="text-slate-600">
            Range: {activePoint.min_temp_c.toFixed(1)}° – {activePoint.max_temp_c.toFixed(1)}°C
          </div>
          <div className="text-slate-500">{activePoint.readings_count} packets rolled up</div>
        </div>
      )}
    </div>
  );
};

/* 3. AI Predictive Thermal Curve (+15m / +30m / +60m) */
export const AiForecastChart: React.FC<{
  recentTemps: number[];
  forecast: TemperatureForecast;
  targetMaxC: number;
}> = ({ recentTemps, forecast, targetMaxC }) => {
  const actual = recentTemps.length > 0 ? recentTemps.slice(-8) : [forecast.current_temp_c];
  const projected = forecast.baseline_ready
    ? [
        actual[actual.length - 1],
        forecast.predicted_15m_c ?? forecast.current_temp_c,
        forecast.predicted_30m_c ?? forecast.current_temp_c,
        forecast.predicted_60m_c ?? forecast.current_temp_c,
      ]
    : [actual[actual.length - 1]];

  const allVals = [...actual, ...projected, targetMaxC, 2];
  const minVal = Math.min(...allVals) - 0.8;
  const maxVal = Math.max(...allVals) + 0.8;

  const width = 500;
  const height = 165;
  const padL = 36;
  const padR = 18;
  const padT = 14;
  const padB = 24;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const totalSteps = Math.max(2, actual.length - 1 + (projected.length - 1));
  const xAt = (idx: number) => padL + (idx / totalSteps) * innerW;
  const yAt = (val: number) =>
    padT + innerH - ((val - minVal) / Math.max(1, maxVal - minVal)) * innerH;

  const actualPoints = actual
    .map((v, i) => `${xAt(i).toFixed(1)},${yAt(v).toFixed(1)}`)
    .join(' ');

  const projOffset = actual.length - 1;
  const projPoints = projected
    .map((v, i) => `${xAt(projOffset + i).toFixed(1)},${yAt(v).toFixed(1)}`)
    .join(' ');

  const projColor =
    forecast.risk_level === 'HIGH'
      ? '#e11d48'
      : forecast.risk_level === 'MODERATE'
        ? '#d97706'
        : '#059669';

  const thresholdY = yAt(targetMaxC);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-40 w-full select-none">
      {/* 8.0°C Upper GDP Threshold */}
      <line
        x1={padL}
        y1={thresholdY}
        x2={width - padR}
        y2={thresholdY}
        stroke="rgba(225, 29, 72, 0.55)"
        strokeDasharray="4 4"
        strokeWidth="1.2"
      />
      <text
        x={width - padR}
        y={thresholdY - 4}
        textAnchor="end"
        className="fill-rose-600 text-[9px] font-mono font-semibold"
      >
        {targetMaxC.toFixed(1)}°C LIMIT
      </text>

      {/* Y Axis Ticks */}
      {[2, 5, 8, 11].map((t) => {
        if (t < minVal || t > maxVal) return null;
        const y = yAt(t);
        return (
          <g key={t}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="rgba(148, 163, 184, 0.25)"
            />
            <text
              x={padL - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-slate-600 text-[10px] font-mono"
            >
              {t}°
            </text>
          </g>
        );
      })}

      {/* Actual Line */}
      <polyline
        fill="none"
        stroke="#2563eb"
        strokeWidth="2.2"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={actualPoints}
      />

      {/* Forecast Dashed Line */}
      {projected.length > 1 && (
        <polyline
          fill="none"
          stroke={projColor}
          strokeWidth="2.2"
          strokeDasharray="5 4"
          strokeLinecap="round"
          strokeLinejoin="round"
          points={projPoints}
        />
      )}

      {/* Horizon dots */}
      {projected.map((v, i) => (
        <circle
          key={i}
          cx={xAt(projOffset + i)}
          cy={yAt(v)}
          r={i === 0 ? 3.5 : 3}
          fill={i === 0 ? '#2563eb' : projColor}
          stroke="#ffffff"
          strokeWidth="1.5"
        />
      ))}

      {/* X Labels */}
      <text x={padL} y={height - 6} className="fill-slate-500 text-[10px] font-mono">
        History
      </text>
      <text
        x={xAt(projOffset)}
        y={height - 6}
        textAnchor="middle"
        className="fill-blue-600 text-[10px] font-mono font-semibold"
      >
        Now
      </text>
      {projected.length > 1 && (
        <>
          <text
            x={xAt(projOffset + 1)}
            y={height - 6}
            textAnchor="middle"
            className="fill-slate-600 text-[10px] font-mono"
          >
            +15m
          </text>
          <text
            x={xAt(projOffset + 2)}
            y={height - 6}
            textAnchor="middle"
            className="fill-slate-600 text-[10px] font-mono"
          >
            +30m
          </text>
          <text
            x={xAt(projOffset + 3)}
            y={height - 6}
            textAnchor="end"
            className="fill-slate-600 text-[10px] font-mono"
          >
            +60m
          </text>
        </>
      )}
    </svg>
  );
};

/* 4. Live Multi-Channel Oscilloscope (Zero-Flicker 1Hz Stream) */
export const LiveOscilloscopeChart: React.FC<{
  history: TelemetryPoint[];
  targetMaxC?: number;
}> = ({ history, targetMaxC = 8.0 }) => {
  const slice = history.slice(-45);
  if (slice.length < 2) {
    return (
      <div className="flex h-48 items-center justify-center text-xs text-slate-500">
        Buffering real-time WebSocket frames...
      </div>
    );
  }

  const width = 680;
  const height = 210;
  const padL = 40;
  const padR = 40;
  const padT = 16;
  const padB = 26;
  const innerW = width - padL - padR;
  const innerH = height - padT - padB;

  const validTemps = slice.map((p) => p.cargo_temp_c).filter((t): t is number => t !== null && t !== undefined && !isNaN(t));
  const hasValidTemps = validTemps.length > 0;
  const tempMin = 0;
  const tempMax = Math.max(12, ...(hasValidTemps ? validTemps.map((t) => t + 1) : [10]));
  const speedMax = Math.max(85, ...slice.map((p) => p.speed_kmh + 10));

  const xPos = (i: number) => padL + (i / (slice.length - 1)) * innerW;
  const yTemp = (t: number) =>
    padT + innerH - ((t - tempMin) / (tempMax - tempMin)) * innerH;
  const ySpeed = (s: number) => padT + innerH - (s / speedMax) * innerH;

  const tempPoints = slice
    .map((p, i) => (p.cargo_temp_c !== null && p.cargo_temp_c !== undefined ? `${xPos(i).toFixed(1)},${yTemp(p.cargo_temp_c).toFixed(1)}` : ''))
    .filter(Boolean)
    .join(' ');
  const speedPoints = slice
    .map((p, i) => `${xPos(i).toFixed(1)},${ySpeed(p.speed_kmh).toFixed(1)}`)
    .join(' ');

  const latest = slice[slice.length - 1];
  const limitY = yTemp(targetMaxC);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-52 w-full select-none">
      <line
        x1={padL}
        y1={limitY}
        x2={width - padR}
        y2={limitY}
        stroke="rgba(225, 29, 72, 0.55)"
        strokeDasharray="4 4"
        strokeWidth="1.2"
      />
      <text
        x={padL + 6}
        y={limitY - 4}
        className="fill-rose-600 text-[9px] font-mono font-semibold"
      >
        {targetMaxC.toFixed(1)}°C LIMIT
      </text>

      {[0, 4, 8, 12].map((t) => {
        if (t > tempMax) return null;
        const y = yTemp(t);
        return (
          <g key={t}>
            <line
              x1={padL}
              y1={y}
              x2={width - padR}
              y2={y}
              stroke="rgba(148, 163, 184, 0.25)"
            />
            <text
              x={padL - 6}
              y={y + 3}
              textAnchor="end"
              className="fill-blue-700 text-[10px] font-mono"
            >
              {t}°C
            </text>
          </g>
        );
      })}

      {[0, 40, 80].map((s) => (
        <text
          key={s}
          x={width - padR + 6}
          y={ySpeed(s) + 3}
          textAnchor="start"
          className="fill-emerald-700 text-[10px] font-mono"
        >
          {s}km/h
        </text>
      ))}

      {/* Speed trace */}
      <polyline
        fill="none"
        stroke="rgba(5, 150, 105, 0.65)"
        strokeWidth="1.6"
        points={speedPoints}
      />

      {/* Temperature trace */}
      <polyline
        fill="none"
        stroke="#2563eb"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
        points={tempPoints}
      />

      {/* Latest live markers */}
      {latest.cargo_temp_c !== null && latest.cargo_temp_c !== undefined && (
        <circle
          cx={xPos(slice.length - 1)}
          cy={yTemp(latest.cargo_temp_c)}
          r="4.5"
          fill={latest.cargo_temp_c > targetMaxC ? '#e11d48' : '#2563eb'}
          stroke="#ffffff"
          strokeWidth="2"
        />
      )}
      <circle
        cx={xPos(slice.length - 1)}
        cy={ySpeed(latest.speed_kmh)}
        r="3.5"
        fill="#059669"
        stroke="#ffffff"
        strokeWidth="1.5"
      />

      {/* Timestamps */}
      <text x={padL} y={height - 6} className="fill-slate-500 text-[10px] font-mono">
        {new Date(slice[0].recorded_at_ms).toLocaleTimeString([], { hour12: false })}
      </text>
      <text
        x={width - padR}
        y={height - 6}
        textAnchor="end"
        className="fill-blue-700 text-[10px] font-mono font-medium"
      >
        SEQ #{latest.seq} · {new Date(latest.recorded_at_ms).toLocaleTimeString([], { hour12: false })}
      </text>
    </svg>
  );
};

/* 5. Fleet Health SVG Donut */
export const HealthDonutChart: React.FC<{
  good: number;
  fair: number;
  poor: number;
  critical: number;
  score: number;
}> = ({ good, fair, poor, critical, score }) => {
  const total = Math.max(1, good + fair + poor + critical);
  const r = 42;
  const c = 2 * Math.PI * r;

  const segments = [
    { label: 'Good', count: good, color: '#059669' },
    { label: 'Fair', count: fair, color: '#2563eb' },
    { label: 'Poor', count: poor, color: '#d97706' },
    { label: 'Critical', count: critical, color: '#e11d48' },
  ];

  let offset = 0;

  return (
    <div className="flex items-center gap-5">
      <div className="relative h-28 w-28 shrink-0">
        <svg viewBox="0 0 110 110" className="h-full w-full -rotate-90">
          <circle
            cx="55"
            cy="55"
            r={r}
            fill="none"
            stroke="rgba(148, 163, 184, 0.2)"
            strokeWidth="12"
          />
          {segments.map((seg) => {
            if (seg.count === 0) return null;
            const len = (seg.count / total) * c;
            const el = (
              <circle
                key={seg.label}
                cx="55"
                cy="55"
                r={r}
                fill="none"
                stroke={seg.color}
                strokeWidth="12"
                strokeDasharray={`${len} ${c - len}`}
                strokeDashoffset={-offset}
              />
            );
            offset += len;
            return el;
          })}
        </svg>
        <div className="absolute inset-0 flex flex-col items-center justify-center">
          <span className="text-xl font-bold font-mono text-slate-900 tabular-nums">
            {score}
          </span>
          <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
            Index
          </span>
        </div>
      </div>

      <div className="grid flex-1 grid-cols-2 gap-x-4 gap-y-2 text-xs">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center justify-between">
            <span className="flex items-center gap-1.5 text-slate-700">
              <span
                className="h-2 w-2 rounded-full"
                style={{ backgroundColor: seg.color }}
              />
              {seg.label}
            </span>
            <span className="font-mono font-semibold text-slate-900 tabular-nums">
              {seg.count}
            </span>
          </div>
        ))}
      </div>
    </div>
  );
};
