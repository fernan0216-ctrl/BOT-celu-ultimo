"use client";
// ============================================================================
// SCALP-OS · Módulo DENSIDAD — libro de órdenes real, muros e imbalance
// ============================================================================
import { BarChart3 } from "lucide-react";
import type { EnginePayload } from "@/shared/types";
import { EmptyState, Panel, Pill, Stat } from "../ui";
import { fmtCompact, fmtPct, fmtPx, fmtUsd } from "@/lib/format";

function LevelRow({
  price,
  qty,
  maxNotional,
  side,
}: {
  price: number;
  qty: number;
  maxNotional: number;
  side: "BID" | "ASK";
}) {
  const notional = price * qty;
  const w = Math.max(3, (notional / maxNotional) * 100);
  const color = side === "BID" ? "rgba(16,185,129,0.28)" : "rgba(239,68,68,0.28)";
  return (
    <div className="relative flex items-center justify-between py-[3px] text-[9px]">
      <div
        className={`absolute top-0 h-full ${side === "BID" ? "left-0" : "right-0"}`}
        style={{ width: `${w}%`, backgroundColor: color }}
      />
      <span className={`relative z-10 font-medium ${side === "BID" ? "text-emerald-400" : "text-red-400"}`}>
        {fmtPx(price)}
      </span>
      <span className="relative z-10 text-zinc-400">{fmtCompact(notional)} USDT</span>
    </div>
  );
}

export default function DensidadView({
  data,
  onSelectSymbol,
}: {
  data: EnginePayload;
  onSelectSymbol: (symbol: string) => void;
}) {
  const depth = data.market.depth;
  const focus = data.market.focusSymbol;

  const maxNotional = depth
    ? Math.max(1, ...depth.bids.map(([p, q]) => p * q), ...depth.asks.map(([p, q]) => p * q))
    : 1;

  return (
    <div className="grid gap-3">
      <Panel title="Activo en foco">
        <div className="flex flex-wrap gap-1.5">
          {data.config.watchlist.map((s) => (
            <button
              key={s}
              onClick={() => onSelectSymbol(s)}
              className={`border px-2.5 py-1 text-[10px] font-semibold tracking-wider transition-colors ${
                s === focus
                  ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300"
                  : "border-white/10 bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
              }`}
            >
              {s.replace("USDT", "")}
            </button>
          ))}
        </div>
      </Panel>

      <Panel
        title={`Densidad del libro · ${focus}`}
        right={<Pill tone="cyan">{depth ? `spread ${depth.spreadPct.toFixed(3)}%` : "…"}</Pill>}
      >
        {depth ? (
          <>
            <div className="grid grid-cols-3 gap-3">
              <Stat label="Mejor bid" value={`$${fmtPx(depth.bestBid)}`} tone="up" />
              <Stat
                label="Imbalance"
                value={fmtPct(depth.imbalancePct, 1)}
                tone={depth.imbalancePct >= 0 ? "up" : "down"}
                sub={depth.imbalancePct >= 0 ? "presión compradora" : "presión vendedora"}
              />
              <Stat label="Mejor ask" value={`$${fmtPx(depth.bestAsk)}`} tone="down" />
            </div>

            <div className="mt-3 h-2 w-full overflow-hidden bg-red-500/25">
              <div
                className="h-full bg-emerald-500/70"
                style={{ width: `${((depth.imbalancePct + 100) / 200) * 100}%` }}
              />
            </div>
            <div className="mt-1 flex justify-between text-[8px] uppercase tracking-widest text-zinc-600">
              <span>bid {fmtUsd(depth.bidVol, 0)}</span>
              <span>ask {fmtUsd(depth.askVol, 0)}</span>
            </div>

            {depth.walls.length > 0 ? (
              <div className="mt-3 space-y-1 border-t border-white/5 pt-2">
                <div className="text-[9px] uppercase tracking-[0.2em] text-zinc-500">
                  Muros &gt; $10K detectados
                </div>
                {depth.walls.map((w, i) => (
                  <div key={i} className="flex items-center justify-between text-[10px]">
                    <Pill tone={w.side === "BID" ? "green" : "red"}>{w.side === "BID" ? "SOPORTE" : "RESISTENCIA"}</Pill>
                    <span className="text-zinc-300">${fmtPx(w.price)}</span>
                    <span className="font-semibold text-zinc-100">{fmtUsd(w.notional, 0)}</span>
                  </div>
                ))}
              </div>
            ) : null}

            <div className="mt-3 grid grid-cols-2 gap-3 border-t border-white/5 pt-3">
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-emerald-500">Bids</div>
                {depth.bids.slice(0, 12).map(([p, q], i) => (
                  <LevelRow key={`b${i}`} price={p} qty={q} maxNotional={maxNotional} side="BID" />
                ))}
              </div>
              <div>
                <div className="mb-1 text-[9px] uppercase tracking-[0.2em] text-red-500">Asks</div>
                {depth.asks.slice(0, 12).map(([p, q], i) => (
                  <LevelRow key={`a${i}`} price={p} qty={q} maxNotional={maxNotional} side="ASK" />
                ))}
              </div>
            </div>
            <div className="mt-2 text-right text-[8px] uppercase tracking-widest text-zinc-600">
              snapshot real · {new Date(depth.updatedAt).toLocaleTimeString("es-ES", { hour12: false })}
            </div>
          </>
        ) : (
          <EmptyState
            icon={<BarChart3 className="h-5 w-5" />}
            title="Libro no disponible"
            desc="Esperando snapshot real de /api/v3/depth para el activo en foco. Toca un símbolo arriba para cambiarlo."
          />
        )}
      </Panel>
    </div>
  );
}
