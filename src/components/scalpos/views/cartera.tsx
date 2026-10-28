"use client";
// ============================================================================
// SCALP-OS · Módulo CARTERA — equity, PnL real, posición activa + countdown
// ============================================================================
import { Activity, Layers, ScrollText, TrendingDown, TrendingUp, Wallet } from "lucide-react";
import type { EnginePayload, PositionPayload } from "@/shared/types";
import {
  CountdownRing,
  EmptyState,
  LiveDot,
  Panel,
  Pill,
  RiskFooterBlock,
  Sparkline,
  Stat,
  useNow,
} from "../ui";
import { fmtClock, fmtPct, fmtPx, fmtQty, fmtSignedUsd, fmtUsd, timeAgo } from "@/lib/format";

const REASON_LABEL: Record<string, string> = {
  TAKE_PROFIT: "TAKE PROFIT",
  STOP_LOSS: "STOP LOSS",
  MAX_WAIT_ROTATION: "MAX WAIT 60S",
  EXTERNAL: "VENTA EXTERNA",
};

function PositionCard({ pos, maxWaitMs }: { pos: PositionPayload; maxWaitMs: number }) {
  const now = useNow(100);
  const remaining = Math.max(0, pos.deadline - now);
  const frac = Math.max(0, Math.min(1, remaining / maxWaitMs));
  const up = pos.pnlPct >= 0;
  const tpPx = pos.entryPrice * 1.015;
  const slPx = pos.entryPrice * 0.99;
  return (
    <div className="relative border border-white/10 bg-black/40 p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-sm font-bold tracking-wider text-zinc-100">{pos.symbol}</span>
            <Pill tone={pos.source === "ENGINE_BUY" ? "cyan" : "amber"}>
              {pos.source === "ENGINE_BUY" ? "MOTOR" : "WALLET SYNC"}
            </Pill>
            <Pill tone={pos.status === "OPEN" ? "green" : pos.status === "EXITING" ? "amber" : "red"}>
              {pos.status === "OPEN" ? "ABIERTA" : pos.status === "EXITING" ? "VENDIENDO" : "DUST"}
            </Pill>
          </div>
          <div className="mt-1.5 text-[10px] text-zinc-500">
            qty {fmtQty(pos.qty)} · entrada ${fmtPx(pos.entryPrice)} → ahora ${fmtPx(pos.currentPrice)}{" "}
            · feed {pos.priceFreshMs < 3000 ? "vivo" : `stale ${(pos.priceFreshMs / 1000).toFixed(0)}s`}
          </div>
        </div>
        <div className="flex flex-col items-center gap-1">
          <CountdownRing deadline={pos.deadline} totalMs={maxWaitMs} />
          <span className="text-[8px] uppercase tracking-[0.16em] text-zinc-500">anti-freeze</span>
        </div>
      </div>

      <div className="mt-2 flex items-end justify-between">
        <div className={`text-xl font-bold ${up ? "text-emerald-400" : "text-red-400"}`}>
          {fmtPct(pos.pnlPct)} <span className="text-xs font-medium">{fmtSignedUsd(pos.pnlUsdt)}</span>
        </div>
        <div className="text-right text-[10px] text-zinc-500">
          valor <span className="text-zinc-300">{fmtUsd(pos.valueUsdt)}</span>
          <br />
          pico {fmtPct(pos.peakPnlPct)}
        </div>
      </div>

      <div className="mt-2 h-1.5 w-full bg-white/5">
        <div
          className="h-full transition-[width] duration-150"
          style={{
            width: `${frac * 100}%`,
            backgroundColor: frac > 0.5 ? "#22d3ee" : frac > 0.18 ? "#f59e0b" : "#ef4444",
          }}
        />
      </div>
      <div className="mt-2 grid grid-cols-2 gap-2 text-[9px] uppercase tracking-wider text-zinc-500">
        <div className="border border-emerald-500/20 bg-emerald-500/5 px-2 py-1">
          TP +1.50% → <span className="text-emerald-300">${fmtPx(tpPx)}</span>
        </div>
        <div className="border border-red-500/20 bg-red-500/5 px-2 py-1">
          SL −1.00% → <span className="text-red-300">${fmtPx(slPx)}</span>
        </div>
      </div>
      {pos.sellAttempts > 0 ? (
        <div className="mt-1.5 text-[9px] text-amber-400">reintentos de venta: {pos.sellAttempts}</div>
      ) : null}
    </div>
  );
}

export default function CarteraView({ data }: { data: EnginePayload }) {
  const { wallet, stats, positions, equitySeries, pnlSeries, trades, logs, config } = data;
  const equityUp = (stats?.realizedPnlToday ?? 0) >= 0;
  const maxAbs = Math.max(1, ...(pnlSeries ?? []).map((d) => Math.abs(d.pnl)));

  return (
    <div className="grid gap-3 md:grid-cols-2">
      {/* ------------------------------------------------ Cartera total */}
      <Panel
        title="Cartera Total · Spot Binance"
        tone="default"
        className="md:col-span-2"
        right={
          <span className="flex items-center gap-1.5 text-[9px] uppercase tracking-widest text-zinc-500">
            <LiveDot on={wallet.syncedAt !== null} /> sync {wallet.syncedAt ? `hace ${timeAgo(wallet.syncedAt)}` : "—"}
          </span>
        }
      >
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <div className="text-[9px] uppercase tracking-[0.24em] text-zinc-500">Equity total</div>
            <div className="text-4xl font-bold tracking-tight text-zinc-50">
              {fmtUsd(wallet.equityUsdt)}
            </div>
            <div className="mt-1 text-[10px] text-zinc-500">
              capital real verificado vía /api/v3/account
            </div>
          </div>
          <div className={`text-right ${equityUp ? "text-emerald-400" : "text-red-400"}`}>
            <div className="text-[9px] uppercase tracking-widest text-zinc-500">PnL realizado hoy</div>
            <div className="text-2xl font-bold">
              {stats ? fmtSignedUsd(stats.realizedPnlToday) : "—"}
            </div>
            <div className="text-[10px] text-zinc-500">
              total {stats ? fmtSignedUsd(stats.realizedPnlTotal) : "—"}
            </div>
          </div>
        </div>

        <div className="mt-3 grid grid-cols-3 gap-3 border-t border-white/5 pt-3">
          <Stat label="USDT libre" value={fmtUsd(wallet.freeUsdt)} />
          <Stat label="En posiciones" value={fmtUsd(wallet.positionsValueUsdt)} />
          <Stat
            label="Win rate"
            value={stats ? `${stats.winRate.toFixed(0)}%` : "—"}
            sub={stats ? `${stats.wins}W / ${stats.losses}L · ${stats.closedTrades} trades` : "sin datos DB"}
          />
        </div>

        <div className="mt-3 border-t border-white/5 pt-2">
          {equitySeries && equitySeries.length >= 2 ? (
            <Sparkline points={equitySeries.map((p) => p.equity)} stroke="#22d3ee" />
          ) : (
            <div className="py-2 text-center text-[9px] uppercase tracking-widest text-zinc-600">
              {equitySeries === null
                ? "Serie de equity no disponible — PostgreSQL sin respuesta"
                : "Serie de equity vacía — primer snapshot a los 30s del arranque"}
            </div>
          )}
        </div>

        {wallet.balances.length > 0 ? (
          <div className="mt-2 flex gap-1.5 overflow-x-auto pb-1">
            {wallet.balances
              .filter((b) => b.valueUsdt >= 0.5)
              .slice(0, 12)
              .map((b) => (
                <span
                  key={b.asset}
                  className="shrink-0 border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] text-zinc-400"
                >
                  <span className="font-semibold text-zinc-200">{b.asset}</span>{" "}
                  {fmtUsd(b.valueUsdt, 2)}
                </span>
              ))}
          </div>
        ) : null}
      </Panel>

      {/* ------------------------------------------------ PnL 7 días */}
      <Panel title="PnL diario · 7 días" right={<Wallet className="h-3.5 w-3.5 text-zinc-600" />}>
        {pnlSeries && pnlSeries.length > 0 ? (
          <div className="flex h-24 items-end gap-1.5">
            {pnlSeries.map((d) => {
              const h = Math.max(6, (Math.abs(d.pnl) / maxAbs) * 88);
              return (
                <div key={d.day} className="flex flex-1 flex-col items-center justify-end gap-1">
                  <span className={`text-[8px] ${d.pnl >= 0 ? "text-emerald-400" : "text-red-400"}`}>
                    {d.pnl >= 0 ? "+" : "−"}${Math.abs(d.pnl).toFixed(2)}
                  </span>
                  <div
                    className={`w-full ${d.pnl >= 0 ? "bg-emerald-500/70" : "bg-red-500/70"}`}
                    style={{ height: h }}
                  />
                  <span className="text-[8px] text-zinc-600">{d.day.slice(5)}</span>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title={pnlSeries === null ? "PostgreSQL sin respuesta" : "Sin trades cerrados"}
            desc="El PnL diario se alimenta exclusivamente de scalpos_trades. Aparecerá tras la primera venta real."
          />
        )}
      </Panel>

      {/* ------------------------------------------------ Posición activa */}
      <Panel
        title={`Posición activa · ${positions.filter((p) => p.status !== "DUST").length}/${config.maxOpenPositions}`}
        right={
          <span className="text-[9px] uppercase tracking-widest text-zinc-500">
            TP {(config.takeProfitPct * 100).toFixed(2)}% · SL −{(config.stopLossPct * 100).toFixed(2)}%
          </span>
        }
      >
        {positions.length > 0 ? (
          <div className="space-y-2">
            {positions.map((p) => (
              <PositionCard key={p.id} pos={p} maxWaitMs={config.maxWaitMs} />
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Layers className="h-5 w-5" />}
            title="Sin posición activa"
            desc="El Agente Gerente está escaneando el consenso de momentum. Si había activos libres >$5 en la cuenta, fueron importados al arrancar."
          />
        )}
      </Panel>

      {/* ------------------------------------------------ Trades cerrados */}
      <Panel
        title={`Trades cerrados · ${trades?.length ?? 0}`}
        right={<Activity className="h-3.5 w-3.5 text-zinc-600" />}
      >
        {trades && trades.length > 0 ? (
          <div className="divide-y divide-white/5">
            {trades.map((t) => {
              const up = t.pnlUsdt >= 0;
              return (
                <div key={t.id} className="flex items-center justify-between gap-2 py-2">
                  <div className="flex items-center gap-2">
                    {up ? (
                      <TrendingUp className="h-3.5 w-3.5 text-emerald-400" />
                    ) : (
                      <TrendingDown className="h-3.5 w-3.5 text-red-400" />
                    )}
                    <div>
                      <div className="text-[11px] font-semibold text-zinc-200">{t.symbol}</div>
                      <div className="text-[9px] text-zinc-500">
                        {REASON_LABEL[t.reason] ?? t.reason} · {fmtClock(new Date(t.closedAt).getTime())}
                      </div>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className={`text-[11px] font-bold ${up ? "text-emerald-400" : "text-red-400"}`}>
                      {fmtSignedUsd(t.pnlUsdt)}
                    </div>
                    <div className="text-[9px] text-zinc-500">{fmtPct(t.pnlPct)}</div>
                  </div>
                </div>
              );
            })}
          </div>
        ) : (
          <EmptyState
            icon={<Activity className="h-5 w-5" />}
            title={trades === null ? "PostgreSQL sin respuesta" : "Historial vacío"}
            desc="Cada venta real ejecutada por el motor se persiste aquí con motivo de cierre y PnL exacto."
          />
        )}
      </Panel>

      {/* ------------------------------------------------ Registro del sistema */}
      <Panel
        title="Registro del motor"
        className="md:col-span-2"
        right={<ScrollText className="h-3.5 w-3.5 text-zinc-600" />}
      >
        {logs.length > 0 ? (
          <div className="max-h-56 space-y-1 overflow-y-auto pr-1">
            {logs.slice(0, 30).map((l, i) => (
              <div key={`${l.t}-${i}`} className="flex items-start gap-2 text-[9.5px] leading-snug">
                <span className="shrink-0 text-zinc-600">{fmtClock(l.t)}</span>
                <span
                  className={`shrink-0 font-semibold ${
                    l.level === "FATAL"
                      ? "text-red-500"
                      : l.level === "ERROR"
                        ? "text-red-400"
                        : l.level === "WARN"
                          ? "text-amber-400"
                          : l.level === "TRADE"
                            ? "text-emerald-400"
                            : l.level === "WS"
                              ? "text-cyan-400"
                              : "text-zinc-500"
                  }`}
                >
                  [{l.tag}]
                </span>
                <span className="text-zinc-400">{l.msg}</span>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<ScrollText className="h-5 w-5" />}
            title="Sin registros"
            desc="El motor aún no ha emitido eventos en esta sesión."
          />
        )}
      </Panel>

      <div className="md:col-span-2">
        <RiskFooterBlock />
      </div>
    </div>
  );
}
