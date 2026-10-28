"use client";
// ============================================================================
// SCALP-OS · Módulo BALLENAS — flujo de órdenes grandes reales (aggTrades)
// ============================================================================
import { ArrowDownRight, ArrowUpRight, Fish } from "lucide-react";
import type { EnginePayload } from "@/shared/types";
import { EmptyState, Panel, Pill, Stat } from "../ui";
import { fmtCompact, fmtClock, fmtPx, fmtUsd } from "@/lib/format";

export default function BallenasView({ data }: { data: EnginePayload }) {
  const whales = data.market.whales;
  const buyFlow = whales.filter((w) => w.side === "BUY").reduce((a, w) => a + w.notional, 0);
  const sellFlow = whales.filter((w) => w.side === "SELL").reduce((a, w) => a + w.notional, 0);
  const net = buyFlow - sellFlow;
  const maxNotional = Math.max(1, ...whales.map((w) => w.notional));

  return (
    <div className="grid gap-3">
      <Panel
        title={`Flujo de ballenas · umbral ≥ $${fmtCompact(data.config.whaleMinNotional)}`}
        right={<Fish className="h-3.5 w-3.5 text-cyan-500" />}
      >
        <div className="grid grid-cols-3 gap-3">
          <Stat label="Presión compra" value={fmtUsd(buyFlow, 0)} tone="up" />
          <Stat label="Presión venta" value={fmtUsd(sellFlow, 0)} tone="down" />
          <Stat
            label="Neto ventana"
            value={fmtUsd(Math.abs(net), 0)}
            tone={net >= 0 ? "up" : "down"}
            sub={net >= 0 ? "dominancia bida" : "dominancia ask"}
          />
        </div>
        <div className="mt-3 flex h-2 w-full overflow-hidden bg-red-500/25">
          <div
            className="h-full bg-emerald-500/70"
            style={{
              width: `${buyFlow + sellFlow > 0 ? (buyFlow / (buyFlow + sellFlow)) * 100 : 50}%`,
            }}
          />
        </div>
      </Panel>

      <Panel
        title="Cinta de ejecuciones grandes"
        right={<Pill tone="cyan">{whales.length} eventos</Pill>}
      >
        {whales.length > 0 ? (
          <div className="space-y-1">
            {whales.map((w) => {
              const intensity = 0.08 + (w.notional / maxNotional) * 0.35;
              const buy = w.side === "BUY";
              return (
                <div
                  key={w.id}
                  className="animate-whale-in flex items-center justify-between gap-2 border border-white/5 px-2.5 py-2"
                  style={{
                    backgroundColor: buy
                      ? `rgba(16,185,129,${intensity})`
                      : `rgba(239,68,68,${intensity})`,
                  }}
                >
                  <div className="flex items-center gap-2">
                    {buy ? (
                      <ArrowUpRight className="h-4 w-4 text-emerald-300" />
                    ) : (
                      <ArrowDownRight className="h-4 w-4 text-red-300" />
                    )}
                    <div>
                      <div className="text-[11px] font-bold text-zinc-100">
                        {w.symbol.replace("USDT", "")}
                        <span className="ml-1.5 text-[9px] font-normal text-zinc-400">
                          @ ${fmtPx(w.price)}
                        </span>
                      </div>
                      <div className="text-[8px] text-zinc-400">
                        qty {fmtCompact(w.qty)} · {fmtClock(w.time)}
                      </div>
                    </div>
                  </div>
                  <div className={`text-sm font-bold ${buy ? "text-emerald-200" : "text-red-200"}`}>
                    {fmtUsd(w.notional, 0)}
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Fish className="h-5 w-5" />}
            title="Sin ballenas en la ventana"
            desc={`Se indexan aggTrades reales de ${data.config.watchlist.length} pares. Solo aparecen ejecuciones ≥ $${fmtCompact(data.config.whaleMinNotional)}.`}
          />
        )}
        <div className="mt-2 text-[8.5px] uppercase tracking-widest text-zinc-600">
          transporte {data.streams.market.transport} · {data.streams.market.connected ? "WS conectado" : "rotación REST 6s/par"}
        </div>
      </Panel>
    </div>
  );
}
