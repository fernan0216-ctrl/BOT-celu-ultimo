"use client";
// ============================================================================
// SCALP-OS · Módulo CONSENSO — momentum multi-timeframe real (1m/5m/15m)
// ============================================================================
import { Gauge } from "lucide-react";
import type { ConsensusItem, EnginePayload } from "@/shared/types";
import { EmptyState, Panel, Pill } from "../ui";
import { fmtPct, fmtPx } from "@/lib/format";

function MomChip({ label, v }: { label: string; v: number }) {
  const tone = v > 0.05 ? "text-emerald-400" : v < -0.05 ? "text-red-400" : "text-zinc-500";
  return (
    <span className="inline-flex items-baseline gap-1 border border-white/5 bg-white/[0.02] px-1.5 py-0.5 text-[9px]">
      <span className="text-zinc-600">{label}</span>
      <span className={`font-semibold ${tone}`}>{fmtPct(v)}</span>
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  const w = Math.min(50, Math.abs(score) / 2);
  return (
    <div className="relative h-2 w-24 bg-white/5">
      <div className="absolute left-1/2 top-0 h-full w-px bg-white/20" />
      {score >= 0 ? (
        <div className="absolute left-1/2 top-0 h-full bg-emerald-500/80" style={{ width: `${w}%` }} />
      ) : (
        <div className="absolute top-0 h-full bg-red-500/80" style={{ right: "50%", width: `${w}%` }} />
      )}
    </div>
  );
}

function rowOf(item: ConsensusItem, rank: number, onClick: () => void) {
  const biasTone =
    item.bias === "ENTRY_ZONE"
      ? "green"
      : item.bias === "LONG"
        ? "cyan"
        : item.bias === "AVOID"
          ? "red"
          : "zinc";
  const biasLabel =
    item.bias === "ENTRY_ZONE"
      ? "ZONA ENTRADA"
      : item.bias === "LONG"
        ? "ALCISTA"
        : item.bias === "AVOID"
          ? "EVITAR"
          : "NEUTRO";
  return (
    <button
      key={item.symbol}
      onClick={onClick}
      className={`flex w-full items-center gap-3 px-3 py-2.5 text-left transition-colors hover:bg-white/[0.04] ${
        item.bias === "ENTRY_ZONE" ? "bg-emerald-500/[0.05]" : ""
      }`}
    >
      <span className="w-4 text-[9px] text-zinc-600">{rank + 1}</span>
      <div className="w-20">
        <div className="text-[11px] font-bold text-zinc-100">{item.symbol.replace("USDT", "")}</div>
        <div className="text-[8px] text-zinc-600">/USDT</div>
      </div>
      <div className="w-16 text-right">
        <div className="text-[10px] text-zinc-300">${fmtPx(item.price)}</div>
        <div
          className={`text-[8px] ${item.chg24hPct >= 0 ? "text-emerald-500" : "text-red-500"}`}
        >
          24h {fmtPct(item.chg24hPct, 1)}
        </div>
      </div>
      <div className="hidden flex-1 flex-wrap justify-end gap-1 min-[420px]:flex">
        <MomChip label="1m" v={item.m1} />
        <MomChip label="5m" v={item.m5} />
        <MomChip label="15m" v={item.m15} />
      </div>
      <div className="flex w-28 flex-col items-end gap-1">
        <ScoreBar score={item.score} />
        <Pill tone={biasTone}>
          {biasLabel} · {item.score}
        </Pill>
      </div>
    </button>
  );
}

export default function ConsensoView({
  data,
  onSelectSymbol,
}: {
  data: EnginePayload;
  onSelectSymbol: (symbol: string) => void;
}) {
  const items = data.market.consensus;
  return (
    <div className="grid gap-3">
      <Panel
        title="Consenso multi-timeframe · momentum real"
        right={
          <span className="text-[9px] uppercase tracking-widest text-zinc-500">
            score = 0.5·1m + 0.3·5m + 0.2·15m
          </span>
        }
      >
        {items.length > 0 ? (
          <div className="-mx-3.5 -my-3.5 divide-y divide-white/5">
            {items.map((it, i) => rowOf(it, i, () => onSelectSymbol(it.symbol)))}
          </div>
        ) : (
          <EmptyState
            icon={<Gauge className="h-5 w-5" />}
            title="Consenso calculándose"
            desc="La capa de mercado está descargando klines reales 1m/5m/15m de Binance Spot. Primera lectura en ~20 segundos."
          />
        )}
        <div className="mt-3 border-t border-white/5 pt-2 text-[9px] leading-relaxed text-zinc-600">
          El Agente Gerente solo ejecuta COMPRA cuando score ≥ {data.config.entryScoreThreshold} con
          confirmación 1m positiva, liquidez 24h ≥ $2M y sin caída diaria severa. Pulsar un activo
          lo fija como foco en Densidad/Análisis.
        </div>
      </Panel>
    </div>
  );
}
