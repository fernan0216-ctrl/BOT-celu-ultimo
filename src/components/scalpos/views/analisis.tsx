"use client";
// ============================================================================
// SCALP-OS · Módulo ANÁLISIS — velas reales de Binance Spot + EMAs + marcador
// de entrada de la posición activa. Fuente: /api/market/klines (proxy Binance).
// ============================================================================
import { useEffect, useMemo, useState } from "react";
import { CandlestickChart } from "lucide-react";
import type { Candle, EnginePayload } from "@/shared/types";
import { EmptyState, Panel, Pill } from "../ui";
import { fmtPct, fmtPx } from "@/lib/format";

interface KlinesResponse {
  symbol: string;
  interval: string;
  candles: Candle[];
  fetchedAt: number | null;
  error?: string;
}

type IntervalId = "1m" | "5m" | "15m";

function emaSeries(values: number[], period: number): number[] {
  if (values.length === 0) return [];
  const k = 2 / (period + 1);
  const out: number[] = [values[0]];
  for (let i = 1; i < values.length; i++) {
    out.push(values[i] * k + (out[i - 1] ?? values[i]) * (1 - k));
  }
  return out;
}

function CandleChart({
  candles,
  entryPrice,
}: {
  candles: Candle[];
  entryPrice: number | null;
}) {
  const W = 340;
  const PRICE_H = 150;
  const VOL_H = 28;
  const H = PRICE_H + VOL_H + 14;
  const n = candles.length;
  const min = Math.min(...candles.map((c) => c.l));
  const max = Math.max(...candles.map((c) => c.h));
  const span = max - min || 1;
  const vMax = Math.max(...candles.map((c) => c.v)) || 1;
  const stepX = W / n;
  const bodyW = Math.max(1.5, stepX * 0.62);
  const y = (p: number) => 4 + ((max - p) / span) * (PRICE_H - 10);

  const closes = candles.map((c) => c.c);
  const ema9 = emaSeries(closes, 9);
  const ema21 = emaSeries(closes, 21);
  const toPath = (arr: number[]) =>
    arr.map((v, i) => `${i === 0 ? "M" : "L"}${(i * stepX + stepX / 2).toFixed(1)},${y(v).toFixed(1)}`).join(" ");

  const gridPcts = [0, 0.25, 0.5, 0.75, 1];
  const last = candles[n - 1];
  const entryVisible = entryPrice !== null && entryPrice >= min && entryPrice <= max;

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-auto w-full">
      {gridPcts.map((g) => {
        const gy = 4 + g * (PRICE_H - 10);
        const pv = max - g * span;
        return (
          <g key={g}>
            <line x1={0} x2={W} y1={gy} y2={gy} stroke="rgba(255,255,255,0.06)" strokeDasharray="2 4" />
            <text x={2} y={gy - 1.5} fontSize={6.5} fill="#52525b">
              {fmtPx(pv)}
            </text>
          </g>
        );
      })}

      {candles.map((c, i) => {
        const x = i * stepX + stepX / 2;
        const up = c.c >= c.o;
        const color = up ? "#10b981" : "#ef4444";
        const yO = y(c.o);
        const yC = y(c.c);
        const top = Math.min(yO, yC);
        const bh = Math.max(0.8, Math.abs(yC - yO));
        const vh = (c.v / vMax) * (VOL_H - 4);
        return (
          <g key={c.t}>
            <line x1={x} x2={x} y1={y(c.h)} y2={y(c.l)} stroke={color} strokeWidth={0.7} />
            <rect x={x - bodyW / 2} y={top} width={bodyW} height={bh} fill={color} />
            <rect
              x={x - bodyW / 2}
              y={PRICE_H + 8 + (VOL_H - vh)}
              width={bodyW}
              height={vh}
              fill={up ? "rgba(16,185,129,0.35)" : "rgba(239,68,68,0.35)"}
            />
          </g>
        );
      })}

      <path d={toPath(ema9)} fill="none" stroke="#22d3ee" strokeWidth={1} opacity={0.9} />
      <path d={toPath(ema21)} fill="none" stroke="#f59e0b" strokeWidth={1} opacity={0.9} />

      {entryVisible ? (
        <g>
          <line
            x1={0}
            x2={W}
            y1={y(entryPrice)}
            y2={y(entryPrice)}
            stroke="#22d3ee"
            strokeWidth={0.8}
            strokeDasharray="5 3"
          />
          <text x={W - 2} y={y(entryPrice) - 2} fontSize={7} fill="#22d3ee" textAnchor="end">
            ENTRADA {fmtPx(entryPrice)}
          </text>
        </g>
      ) : null}

      <rect
        x={W - 52}
        y={y(last.c) - 6}
        width={50}
        height={11}
        fill={last.c >= last.o ? "#064e3b" : "#450a0a"}
      />
      <text x={W - 27} y={y(last.c) + 2.5} fontSize={7} fill="#e5e7eb" textAnchor="middle">
        {fmtPx(last.c)}
      </text>
    </svg>
  );
}

const INTERVALS: IntervalId[] = ["1m", "5m", "15m"];

export default function AnalisisView({
  data,
  onSelectSymbol,
}: {
  data: EnginePayload;
  onSelectSymbol: (symbol: string) => void;
}) {
  const symbol = data.market.focusSymbol;
  const [intervalId, setIntervalId] = useState<IntervalId>("1m");
  const [kdata, setKdata] = useState<KlinesResponse | null>(null);
  const [fetchErr, setFetchErr] = useState<string | null>(null);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout>;
    async function load() {
      try {
        const res = await fetch(
          `/api/market/klines?symbol=${encodeURIComponent(symbol)}&interval=${intervalId}&limit=90`,
          { cache: "no-store" },
        );
        const json = (await res.json()) as KlinesResponse;
        if (!stop) {
          setKdata(json);
          setFetchErr(res.ok ? null : (json.error ?? `HTTP ${res.status}`));
        }
      } catch (err) {
        if (!stop) setFetchErr(err instanceof Error ? err.message : String(err));
      } finally {
        if (!stop) timer = setTimeout(load, 4000);
      }
    }
    void load();
    return () => {
      stop = true;
      clearTimeout(timer);
    };
  }, [symbol, intervalId]);

  const consensusRow = useMemo(
    () => data.market.consensus.find((c) => c.symbol === symbol) ?? null,
    [data.market.consensus, symbol],
  );
  const openPos = data.positions.find((p) => p.symbol === symbol) ?? null;
  const candles = kdata?.candles ?? [];

  return (
    <div className="grid gap-3">
      <Panel title="Activo e intervalo">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex flex-wrap gap-1.5">
            {data.config.watchlist.map((s) => (
              <button
                key={s}
                onClick={() => onSelectSymbol(s)}
                className={`border px-2.5 py-1 text-[10px] font-semibold tracking-wider transition-colors ${
                  s === symbol
                    ? "border-cyan-400/60 bg-cyan-400/10 text-cyan-300"
                    : "border-white/10 bg-white/[0.02] text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {s.replace("USDT", "")}
              </button>
            ))}
          </div>
          <div className="flex gap-1">
            {INTERVALS.map((iv) => (
              <button
                key={iv}
                onClick={() => setIntervalId(iv)}
                className={`border px-2.5 py-1 text-[10px] font-semibold ${
                  iv === intervalId
                    ? "border-amber-400/60 bg-amber-400/10 text-amber-300"
                    : "border-white/10 text-zinc-500 hover:text-zinc-300"
                }`}
              >
                {iv}
              </button>
            ))}
          </div>
        </div>
      </Panel>

      <Panel
        title={`${symbol} · ${intervalId} · Binance Spot live`}
        right={
          consensusRow ? (
            <Pill tone={consensusRow.chg24hPct >= 0 ? "green" : "red"}>
              24h {fmtPct(consensusRow.chg24hPct, 1)}
            </Pill>
          ) : undefined
        }
      >
        {fetchErr ? (
          <EmptyState
            icon={<CandlestickChart className="h-5 w-5" />}
            title="Feed de velas sin respuesta"
            desc={`Respuesta real de la capa de mercado: ${fetchErr}`}
          />
        ) : candles.length >= 10 ? (
          <>
            <CandleChart candles={candles} entryPrice={openPos ? openPos.entryPrice : null} />
            <div className="mt-2 flex flex-wrap items-center gap-3 border-t border-white/5 pt-2 text-[9px] uppercase tracking-widest text-zinc-500">
              <span className="text-cyan-300">— EMA9</span>
              <span className="text-amber-300">— EMA21</span>
              {openPos ? <span className="text-cyan-200">- - ENTRADA ${fmtPx(openPos.entryPrice)}</span> : null}
              <span className="ml-auto">
                {candles.length} velas reales · src {kdata?.symbol}
              </span>
            </div>
            {consensusRow ? (
              <div className="mt-2 grid grid-cols-4 gap-2 text-center">
                {[
                  { l: "Mom 1m", v: consensusRow.m1 },
                  { l: "Mom 5m", v: consensusRow.m5 },
                  { l: "Mom 15m", v: consensusRow.m15 },
                  { l: "Score", v: consensusRow.score, plain: true },
                ].map((m) => (
                  <div key={m.l} className="border border-white/5 bg-white/[0.02] px-1 py-1.5">
                    <div className="text-[8px] uppercase tracking-widest text-zinc-600">{m.l}</div>
                    <div
                      className={`text-[11px] font-bold ${
                        m.plain ? "text-zinc-100" : m.v >= 0 ? "text-emerald-400" : "text-red-400"
                      }`}
                    >
                      {m.plain ? m.v : fmtPct(m.v)}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
          </>
        ) : (
          <EmptyState
            icon={<CandlestickChart className="h-5 w-5" />}
            title="Cargando velas reales"
            desc="Descargando klines de Binance Spot…"
          />
        )}
      </Panel>
    </div>
  );
}
