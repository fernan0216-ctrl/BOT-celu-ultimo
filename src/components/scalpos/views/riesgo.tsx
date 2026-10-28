"use client";
// ============================================================================
// SCALP-OS · Módulo RIESGO — parámetros reales, exposición, frenos y streams
// ============================================================================
import { Radio, ShieldAlert, Timer, Zap } from "lucide-react";
import type { EnginePayload } from "@/shared/types";
import { EmptyState, LiveDot, Panel, Pill, Stat, useNow } from "../ui";
import { fmtClock, fmtPx, fmtQty, fmtSignedUsd, fmtUsd, timeAgo } from "@/lib/format";

export default function RiesgoView({ data }: { data: EnginePayload }) {
  const now = useNow(250);
  const { config, wallet, streams, engine, stats, executions } = data;
  const exposure = wallet.equityUsdt > 0 ? (wallet.positionsValueUsdt / wallet.equityUsdt) * 100 : 0;
  const pnlToday = stats?.realizedPnlToday ?? 0;
  const lossUsed =
    pnlToday < 0 ? Math.min(100, (Math.abs(pnlToday) / config.maxDailyLossUsdt) * 100) : 0;
  const renewIn = streams.user.listenKeyAgeMs
    ? Math.max(0, config.listenKeyRenewMs - streams.user.listenKeyAgeMs)
    : null;

  const params: Array<{ label: string; value: string }> = [
    { label: "Take Profit", value: `+${(config.takeProfitPct * 100).toFixed(2)}%` },
    { label: "Stop Loss", value: `−${(config.stopLossPct * 100).toFixed(2)}%` },
    { label: "Max Wait (anti-freeze)", value: `${(config.maxWaitMs / 1000).toFixed(0)}s → MERCADO` },
    { label: "Bucle macro", value: `${(config.loopMs / 1000).toFixed(0)}s` },
    { label: "Protección ms", value: `${config.microLoopMs}ms` },
    { label: "Enfriamiento post-trade", value: `${(config.postTradeCooldownMs / 1000).toFixed(0)}s` },
    { label: "Posiciones máx.", value: String(config.maxOpenPositions) },
    { label: "Tamaño por trade", value: `$${config.perTradeUsdt} (mín. seguridad $${config.minSafetyUsdt})` },
    { label: "Freno diario", value: `−$${config.maxDailyLossUsdt}` },
    { label: "Renovación listenKey", value: `${config.listenKeyRenewMs / 60000} min` },
  ];

  return (
    <div className="grid gap-3 md:grid-cols-2">
      <Panel title="Parámetros del motor · modo real" right={<ShieldAlert className="h-3.5 w-3.5 text-amber-500" />}>
        <div className="grid grid-cols-2 gap-2">
          {params.map((p) => (
            <div key={p.label} className="border border-white/5 bg-white/[0.02] px-2.5 py-2">
              <div className="text-[8px] uppercase tracking-[0.18em] text-zinc-600">{p.label}</div>
              <div className="mt-0.5 text-[11px] font-semibold text-zinc-100">{p.value}</div>
            </div>
          ))}
        </div>
      </Panel>

      <div className="grid gap-3">
        <Panel title="Exposición y freno diario">
          <div className="flex items-center justify-between text-[9px] uppercase tracking-widest text-zinc-500">
            <span>Exposición en posiciones</span>
            <span className="text-zinc-200">{exposure.toFixed(1)}%</span>
          </div>
          <div className="mt-1 h-2 w-full bg-white/5">
            <div
              className={`h-full ${exposure > 75 ? "bg-red-500/80" : exposure > 40 ? "bg-amber-400/80" : "bg-emerald-500/80"}`}
              style={{ width: `${Math.min(100, exposure)}%` }}
            />
          </div>

          <div className="mt-3 flex items-center justify-between text-[9px] uppercase tracking-widest text-zinc-500">
            <span>Pérdida diaria usada</span>
            <span className={pnlToday < 0 ? "text-red-300" : "text-emerald-300"}>
              {fmtSignedUsd(pnlToday, 2)} / −${config.maxDailyLossUsdt}
            </span>
          </div>
          <div className="mt-1 h-2 w-full bg-white/5">
            <div className="h-full bg-red-500/80" style={{ width: `${lossUsed}%` }} />
          </div>
          {engine.dailyHaltDate ? (
            <div className="mt-2">
              <Pill tone="red" blink>
                Freno diario ACTIVO ({engine.dailyHaltDate}) — entradas suspendidas
              </Pill>
            </div>
          ) : null}
        </Panel>

        <Panel title="Streams · tiempo real" right={<Radio className="h-3.5 w-3.5 text-cyan-500" />}>
          <div className="space-y-2 text-[10px]">
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-zinc-400">
                <LiveDot on={streams.market.connected || streams.market.transport === "REST"} />
                Market data
              </span>
              <span className="text-zinc-300">
                {streams.market.transport}
                {streams.market.connected ? " conectado" : " · polling"} ·{" "}
                {streams.market.lastMsgAt ? `último msg hace ${timeAgo(streams.market.lastMsgAt)}` : "sin msgs WS"}
                {streams.market.reconnects > 0 ? ` · ${streams.market.reconnects} reconex.` : ""}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-zinc-400">
                <LiveDot on={streams.user.connected} tone="green" />
                User Data Stream (listenKey)
              </span>
              <span className="text-zinc-300">
                {streams.user.connected ? "conectado" : "desconectado"} · renovaciones {streams.user.renewals}
                {renewIn !== null ? ` · renova en ${Math.round(renewIn / 1000)}s` : ""}
              </span>
            </div>
            <div className="flex items-center justify-between">
              <span className="flex items-center gap-2 text-zinc-400">
                <Zap className="h-3 w-3 text-amber-400" /> Peso API REST (1 min)
              </span>
              <span className="text-zinc-300">{wallet.apiWeightPerMin} / 1200</span>
            </div>
            {streams.user.lastError ? (
              <div className="border border-red-500/25 bg-red-500/5 px-2 py-1 text-[9px] text-red-300">
                WS privado: {streams.user.lastError}
              </div>
            ) : null}
          </div>
        </Panel>
      </div>

      <Panel
        title="Fills indexados · executionReport"
        className="md:col-span-2"
        right={<Timer className="h-3.5 w-3.5 text-zinc-600" />}
      >
        {executions.length > 0 ? (
          <div className="divide-y divide-white/5">
            {executions.slice(0, 8).map((x, i) => (
              <div key={`${x.orderId}-${i}`} className="flex items-center justify-between py-1.5 text-[10px]">
                <div className="flex items-center gap-2">
                  <Pill tone={x.side === "BUY" ? "green" : "red"}>{x.side}</Pill>
                  <span className="font-semibold text-zinc-200">{x.symbol}</span>
                  <span className="text-zinc-500">
                    {fmtQty(x.cumQty)} @ {fmtPx(x.lastPrice || x.cumQuote / (x.cumQty || 1))}
                  </span>
                </div>
                <div className="text-zinc-500">
                  {x.status} · {fmtClock(x.time)}
                </div>
              </div>
            ))}
          </div>
        ) : (
          <EmptyState
            icon={<Timer className="h-5 w-5" />}
            title="Sin fills indexados"
            desc="Cuando el User Data Stream esté conectado con credenciales válidas, cada executionReport aparecerá aquí al instante."
          />
        )}
      </Panel>
    </div>
  );
}
