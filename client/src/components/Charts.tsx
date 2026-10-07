/**
 * GEOPOLIS — Graphiques (recharts) : toujours branchés sur les vraies
 * données de la simulation (séries historiques pays & marché mondial).
 */
import {
  Area, AreaChart, Bar, BarChart, CartesianGrid, Line, LineChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from 'recharts';
import { GlassCard } from './ui.js';

const AXIS_STYLE = { fontSize: 11, fill: '#8b90ab' } as const;
const TOOLTIP_STYLE = {
  backgroundColor: 'rgba(12, 15, 30, 0.96)',
  border: '1px solid rgba(255,255,255,0.1)',
  borderRadius: 10,
  fontSize: 12,
  color: '#f4f5fb',
} as const;

export interface SeriesData {
  day: number;
  value: number;
}

export function LineChartCard({
  title,
  data,
  color = '#5b8cff',
  height = 220,
  unit = '',
  dataKey = 'value',
  secondData,
  secondColor = '#3ddc97',
  secondKey = 'value2',
}: {
  title: string;
  data: Record<string, number>[];
  color?: string;
  height?: number;
  unit?: string;
  dataKey?: string;
  secondData?: Record<string, number>[];
  secondColor?: string;
  secondKey?: string;
}) {
  const merged = secondData
    ? data.map((d, i) => ({ ...d, [secondKey]: secondData[i]?.[dataKey] ?? null }))
    : data;
  return (
    <GlassCard>
      <div className="row-between mb-8">
        <h3 style={{ margin: 0, fontSize: '0.95rem' }}>{title}</h3>
        {unit && <span className="tiny muted">{unit}</span>}
      </div>
      <ResponsiveContainer width="100%" height={height}>
        <LineChart data={merged} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="day" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Line
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            dot={false}
            animationDuration={600}
            isAnimationActive={true}
          />
          {secondData && (
            <Line type="monotone" dataKey={secondKey} stroke={secondColor} strokeWidth={1.6} dot={false} strokeDasharray="4 3" />
          )}
        </LineChart>
      </ResponsiveContainer>
    </GlassCard>
  );
}

export function AreaChartCard({
  title,
  data,
  color = '#7fb2c9',
  height = 200,
  dataKey = 'value',
}: {
  title: string;
  data: Record<string, number>[];
  color?: string;
  height?: number;
  dataKey?: string;
}) {
  return (
    <GlassCard>
      <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <AreaChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <defs>
            <linearGradient id={`grad-${dataKey}-${color.slice(1)}`} x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={color} stopOpacity={0.4} />
              <stop offset="100%" stopColor={color} stopOpacity={0.02} />
            </linearGradient>
          </defs>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey="day" tick={AXIS_STYLE} tickLine={false} axisLine={false} minTickGap={40} />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} />
          <Tooltip contentStyle={TOOLTIP_STYLE} />
          <Area
            type="monotone"
            dataKey={dataKey}
            stroke={color}
            strokeWidth={2}
            fill={`url(#grad-${dataKey}-${color.slice(1)})`}
            animationDuration={600}
          />
        </AreaChart>
      </ResponsiveContainer>
    </GlassCard>
  );
}

export function BarChartCard({
  title,
  data,
  xKey = 'name',
  yKey = 'value',
  color = '#5b8cff',
  height = 220,
}: {
  title: string;
  data: Record<string, string | number>[];
  xKey?: string;
  yKey?: string;
  color?: string;
  height?: number;
}) {
  return (
    <GlassCard>
      <h3 style={{ margin: '0 0 8px', fontSize: '0.95rem' }}>{title}</h3>
      <ResponsiveContainer width="100%" height={height}>
        <BarChart data={data} margin={{ top: 6, right: 8, bottom: 0, left: -14 }}>
          <CartesianGrid stroke="rgba(255,255,255,0.05)" vertical={false} />
          <XAxis dataKey={xKey} tick={AXIS_STYLE} tickLine={false} axisLine={false} interval={0} angle={-20} textAnchor="end" height={48} />
          <YAxis tick={AXIS_STYLE} tickLine={false} axisLine={false} width={54} />
          <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: 'rgba(255,255,255,0.04)' }} />
          <Bar dataKey={yKey} fill={color} radius={[5, 5, 0, 0]} animationDuration={600} />
        </BarChart>
      </ResponsiveContainer>
    </GlassCard>
  );
}

export function Sparkline({ data, color = '#5b8cff', height = 34, width = 96 }: { data: number[]; color?: string; height?: number; width?: number }) {
  if (data.length < 2) return <div style={{ width, height }} />;
  const min = Math.min(...data);
  const max = Math.max(...data);
  const range = max - min || 1;
  const pts = data.map((v, i) => {
    const x = (i / (data.length - 1)) * width;
    const y = height - 3 - ((v - min) / range) * (height - 6);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });
  return (
    <svg width={width} height={height} aria-hidden style={{ display: 'block' }}>
      <polyline points={pts.join(' ')} fill="none" stroke={color} strokeWidth="1.8" strokeLinecap="round" opacity={0.9} />
    </svg>
  );
}
