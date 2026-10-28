// ============================================================================
// SCALP-OS · Formateadores numéricos (display de datos reales)
// ============================================================================

export function fmtUsd(n: number, dp = 2): string {
  return n.toLocaleString("en-US", {
    style: "currency",
    currency: "USD",
    minimumFractionDigits: dp,
    maximumFractionDigits: dp,
  });
}

export function fmtSignedUsd(n: number, dp = 4): string {
  const abs = fmtUsd(Math.abs(n), dp);
  return `${n >= 0 ? "+" : "−"}${abs}`;
}

export function fmtPct(n: number, dp = 2): string {
  return `${n >= 0 ? "+" : ""}${n.toFixed(dp)}%`;
}

/** Precio con decimales adaptativos según magnitud. */
export function fmtPx(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const dp = n >= 500 ? 2 : n >= 1 ? 4 : n >= 0.01 ? 6 : 8;
  return n.toLocaleString("en-US", { minimumFractionDigits: dp, maximumFractionDigits: dp });
}

export function fmtQty(n: number): string {
  if (!Number.isFinite(n)) return "—";
  const dp = n >= 100 ? 2 : n >= 1 ? 4 : 6;
  return n.toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: dp });
}

export function fmtCompact(n: number): string {
  if (n >= 1_000_000_000) return `${(n / 1_000_000_000).toFixed(2)}B`;
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(2)}M`;
  if (n >= 1_000) return `${(n / 1_000).toFixed(1)}K`;
  return n.toFixed(0);
}

/** Cuenta regresiva "MM:SS.d" para el Max Wait Time. */
export function fmtCountdown(ms: number): string {
  const clamped = Math.max(0, ms);
  const totalSec = clamped / 1000;
  const m = Math.floor(totalSec / 60);
  const s = Math.floor(totalSec % 60);
  const d = Math.floor((clamped % 1000) / 100);
  return `${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}.${d}`;
}

export function fmtClock(t: number): string {
  return new Date(t).toLocaleTimeString("es-ES", { hour12: false });
}

export function fmtUptime(ms: number): string {
  const s = Math.floor(ms / 1000);
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
}

export function timeAgo(t: number | null): string {
  if (!t) return "—";
  const s = Math.max(0, Math.round((Date.now() - t) / 1000));
  if (s < 60) return `${s}s`;
  if (s < 3600) return `${Math.floor(s / 60)}m ${s % 60}s`;
  return `${Math.floor(s / 3600)}h`;
}
