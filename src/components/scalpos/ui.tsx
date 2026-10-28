"use client";
// ============================================================================
// SCALP-OS · Kit UI industrial compartido
// ============================================================================
import { useEffect, useState, type ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { fmtCountdown } from "@/lib/format";

export function useNow(intervalMs: number): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(t);
  }, [intervalMs]);
  return now;
}

// ---------------------------------------------------------------- Panel
export function Panel({
  title,
  right,
  children,
  className = "",
  tone = "default",
}: {
  title?: string;
  right?: ReactNode;
  children: ReactNode;
  className?: string;
  tone?: "default" | "danger" | "ok";
}) {
  const border =
    tone === "danger"
      ? "border-red-500/40"
      : tone === "ok"
        ? "border-emerald-500/40"
        : "border-white/10";
  const corner =
    tone === "danger" ? "border-red-500/70" : tone === "ok" ? "border-emerald-500/70" : "border-white/25";
  return (
    <section className={`relative overflow-hidden border ${border} bg-[#090d13]/90 ${className}`}>
      <span aria-hidden className={`pointer-events-none absolute left-0 top-0 h-2.5 w-2.5 border-l border-t ${corner}`} />
      <span aria-hidden className={`pointer-events-none absolute right-0 top-0 h-2.5 w-2.5 border-r border-t ${corner}`} />
      <span aria-hidden className={`pointer-events-none absolute bottom-0 left-0 h-2.5 w-2.5 border-b border-l ${corner}`} />
      <span aria-hidden className={`pointer-events-none absolute bottom-0 right-0 h-2.5 w-2.5 border-b border-r ${corner}`} />
      {title ? (
        <header className="flex items-center justify-between gap-2 border-b border-white/5 px-3.5 py-2.5">
          <div className="flex items-center gap-2">
            <span className="h-3 w-[3px] bg-cyan-400/80" />
            <h2 className="text-[10px] font-semibold uppercase tracking-[0.22em] text-zinc-400">
              {title}
            </h2>
          </div>
          {right}
        </header>
      ) : null}
      <div className="p-3.5">{children}</div>
    </section>
  );
}

// ---------------------------------------------------------------- Píldoras
const TONES: Record<string, string> = {
  green: "border-emerald-500/40 bg-emerald-500/10 text-emerald-400",
  red: "border-red-500/40 bg-red-500/10 text-red-400",
  amber: "border-amber-500/40 bg-amber-500/10 text-amber-400",
  cyan: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  zinc: "border-white/15 bg-white/5 text-zinc-400",
};

export function Pill({
  tone = "zinc",
  children,
  blink = false,
}: {
  tone?: keyof typeof TONES;
  children: ReactNode;
  blink?: boolean;
}) {
  return (
    <span
      className={`inline-flex items-center gap-1.5 border px-2 py-0.5 text-[10px] font-semibold uppercase tracking-[0.14em] ${TONES[tone]} ${blink ? "animate-blink" : ""}`}
    >
      {children}
    </span>
  );
}

export function LiveDot({ on, tone = "green" }: { on: boolean; tone?: "green" | "red" }) {
  const color = on
    ? tone === "green"
      ? "bg-emerald-400 text-emerald-400"
      : "bg-red-400 text-red-400"
    : "bg-zinc-600 text-zinc-600";
  return (
    <span className={`inline-block h-2 w-2 rounded-full ${color} ${on ? "animate-pulse-dot" : ""}`} />
  );
}

// ----------------------------------------------------------- Countdown ring
export function CountdownRing({
  deadline,
  totalMs,
  size = 56,
}: {
  deadline: number;
  totalMs: number;
  size?: number;
}) {
  const now = useNow(100);
  const remaining = deadline - now;
  const frac = Math.max(0, Math.min(1, remaining / totalMs));
  const r = (size - 8) / 2;
  const c = 2 * Math.PI * r;
  const color = frac > 0.5 ? "#22d3ee" : frac > 0.18 ? "#f59e0b" : "#ef4444";
  return (
    <div className="relative" style={{ width: size, height: size }}>
      <svg width={size} height={size} className="-rotate-90">
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="rgba(255,255,255,0.08)" strokeWidth={3} />
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke={color}
          strokeWidth={3}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - frac)}
          strokeLinecap="butt"
        />
      </svg>
      <div
        className="absolute inset-0 flex items-center justify-center text-[10px] font-semibold"
        style={{ color }}
      >
        {fmtCountdown(remaining)}
      </div>
    </div>
  );
}

// --------------------------------------------------------------- Sparkline
export function Sparkline({
  points,
  width = 260,
  height = 56,
  stroke = "#22d3ee",
}: {
  points: number[];
  width?: number;
  height?: number;
  stroke?: string;
}) {
  if (points.length < 2) return null;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => `${(i * step).toFixed(1)},${(height - 4 - ((p - min) / span) * (height - 10)).toFixed(1)}`);
  const area = `M0,${height} L${coords.join(" L")} L${width},${height} Z`;
  const line = `M${coords.join(" L")}`;
  const id = `sg-${stroke.replace("#", "")}`;
  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="h-14 w-full" preserveAspectRatio="none">
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor={stroke} stopOpacity="0.25" />
          <stop offset="100%" stopColor={stroke} stopOpacity="0" />
        </linearGradient>
      </defs>
      <path d={area} fill={`url(#${id})`} />
      <path d={line} fill="none" stroke={stroke} strokeWidth="1.4" />
    </svg>
  );
}

// ------------------------------------------------------------------ Métrica
export function Stat({
  label,
  value,
  sub,
  tone = "default",
}: {
  label: string;
  value: ReactNode;
  sub?: ReactNode;
  tone?: "default" | "up" | "down";
}) {
  const color = tone === "up" ? "text-emerald-400" : tone === "down" ? "text-red-400" : "text-zinc-100";
  return (
    <div className="min-w-0">
      <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">{label}</div>
      <div className={`truncate text-base font-semibold ${color}`}>{value}</div>
      {sub ? <div className="truncate text-[10px] text-zinc-500">{sub}</div> : null}
    </div>
  );
}

// ------------------------------------------------------------- Estado vacío
export function EmptyState({
  icon,
  title,
  desc,
}: {
  icon: ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div className="flex flex-col items-center gap-2 py-8 text-center">
      <div className="text-zinc-600">{icon}</div>
      <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-zinc-400">{title}</div>
      <div className="max-w-[300px] text-[10px] leading-relaxed text-zinc-600">{desc}</div>
    </div>
  );
}

// ------------------------------------------------------- Aviso de riesgo real
export function RiskStrip() {
  return (
    <div className="border-t border-red-500/25 bg-[#12060a]/95 px-3 py-1.5">
      <div className="mx-auto flex max-w-5xl items-center gap-2 text-red-400/90">
        <AlertTriangle className="h-3 w-3 shrink-0" />
        <p className="text-[8.5px] leading-tight tracking-wide">
          AVISO DE RIESGO REAL: SCALP-OS opera con capital real en Binance Spot. El scalping
          automatizado puede generar la pérdida total del capital. No existe modo simulación.
        </p>
      </div>
    </div>
  );
}

export function RiskFooterBlock() {
  return (
    <Panel tone="danger" className="mt-4">
      <div className="space-y-1.5 text-[9.5px] leading-relaxed text-red-300/80">
        <p className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0 text-red-400" />
          <span>
            ADVERTENCIA DE RIESGO OBLIGATORIA — Este sistema ejecuta órdenes reales a mercado con
            fondos reales de tu cuenta Binance Spot. Las estrategias de alta frecuencia (TP +1.5% /
            SL −1.0% / Max Wait 60s) no garantizan beneficios y pueden liquidar valor por slippage,
            comisiones o gaps de liquidez.
          </span>
        </p>
        <p className="pl-5 text-red-400/60">
          CERO SIMULACIÓN: todo valor mostrado proviene de la API real de Binance y de PostgreSQL.
          Si el motor está en FATAL es porque las credenciales fallaron o no hay saldo operable.
        </p>
      </div>
    </Panel>
  );
}
