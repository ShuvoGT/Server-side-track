'use client';

import { useState } from 'react';

export interface ChartPoint {
  /** Full label for the tooltip and table, e.g. "13 Oct, 14:00". */
  label: string;
  /** Short axis label; empty to skip a tick. */
  tick: string;
  value: number;
}

const W = 720;
const H = 220;
const PAD = { top: 12, right: 8, bottom: 24, left: 44 };
const numberFormat = new Intl.NumberFormat('en');

/** Rounds the axis maximum up to 1, 2 or 5 × 10^n so gridlines land on readable values. */
function niceMax(value: number): number {
  if (value <= 4) return 4;
  const power = 10 ** Math.floor(Math.log10(value));
  const step = [1, 2, 5, 10].find((s) => s * power >= value)!;
  return step * power;
}

/**
 * Single-series column chart: one hue, no legend (the title names the series), recessive grid, hover tooltip,
 * and a table view for screen readers and exact values.
 */
export function UsageChart({ title, points }: { title: string; points: ChartPoint[] }) {
  const [hover, setHover] = useState<number | null>(null);
  const [showTable, setShowTable] = useState(false);
  const max = niceMax(Math.max(0, ...points.map((p) => p.value)));
  const plotW = W - PAD.left - PAD.right;
  const plotH = H - PAD.top - PAD.bottom;
  const slot = plotW / Math.max(points.length, 1);
  const gap = slot > 6 ? 2 : 1;
  const barW = Math.max(slot - gap, 1);
  const y = (v: number) => PAD.top + plotH - (v / max) * plotH;
  const ticks = [0, max / 2, max];
  const hovered = hover !== null ? points[hover] : null;

  return (
    <div className="stack" style={{ gap: 10 }}>
      <div className="row" style={{ justifyContent: 'space-between' }}>
        <h2>{title}</h2>
        <div className="segmented" role="group" aria-label="View">
          <button type="button" aria-pressed={!showTable} onClick={() => setShowTable(false)}>
            Chart
          </button>
          <button type="button" aria-pressed={showTable} onClick={() => setShowTable(true)}>
            Table
          </button>
        </div>
      </div>
      {showTable ? (
        <div className="table-wrap" style={{ maxHeight: 320, overflowY: 'auto' }}>
          <table className="table table-compact">
            <thead>
              <tr>
                <th>Period</th>
                <th className="num">Requests</th>
              </tr>
            </thead>
            <tbody>
              {points.map((p) => (
                <tr key={p.label}>
                  <td>{p.label}</td>
                  <td className="num">{numberFormat.format(p.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart" onMouseLeave={() => setHover(null)}>
          <svg viewBox={`0 0 ${W} ${H}`} role="img" aria-label={`${title}. Use the table view for values.`}>
            {ticks.map((t) => (
              <g key={t}>
                <line className="grid-line" x1={PAD.left} x2={W - PAD.right} y1={y(t)} y2={y(t)} />
                <text className="axis-label" x={PAD.left - 8} y={y(t) + 4} textAnchor="end">
                  {numberFormat.format(t)}
                </text>
              </g>
            ))}
            {points.map((p, i) => {
              const x = PAD.left + i * slot + gap / 2;
              const h = Math.max(PAD.top + plotH - y(p.value), p.value > 0 ? 1 : 0);
              const r = Math.min(4, barW / 2, h);
              const top = PAD.top + plotH - h;
              return (
                <g key={p.label}>
                  {h > 0 && (
                    // Rounded data end, square at the baseline.
                    <path
                      className={`bar${hover !== null && hover !== i ? ' dim' : ''}`}
                      d={`M${x},${top + h} V${top + r} Q${x},${top} ${x + r},${top} H${x + barW - r} Q${x + barW},${top} ${x + barW},${top + r} V${top + h} Z`}
                    />
                  )}
                  {p.tick && (
                    <text className="axis-label" x={x + barW / 2} y={H - 6} textAnchor="middle">
                      {p.tick}
                    </text>
                  )}
                  {/* Hit target: the full column, larger than the bar. */}
                  <rect
                    x={PAD.left + i * slot}
                    y={PAD.top}
                    width={slot}
                    height={plotH}
                    fill="transparent"
                    onMouseEnter={() => setHover(i)}
                  />
                </g>
              );
            })}
          </svg>
          {hovered && hover !== null && (
            <div
              className="tooltip"
              style={{
                left: `${((PAD.left + hover * slot + slot / 2) / W) * 100}%`,
                top: `${(y(hovered.value) / H) * 100}%`,
              }}
            >
              {hovered.label}: <strong>{numberFormat.format(hovered.value)}</strong>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
