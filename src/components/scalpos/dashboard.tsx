"use client";
// ============================================================================
// SCALP-OS · Terminal principal — polling real de /api/engine/state cada 2s.
// ============================================================================
import { useEffect, useRef, useState } from "react";
import {
  BarChartHorizontal,
  CandlestickChart,
  Copy,
  Fish,
  Network,
  OctagonAlert,
  ShieldAlert,
  SquareTerminal,
  Wallet,
  type LucideIcon,
} from "lucide-react";
import type { EnginePayload, EngineStateCode } from "@/shared/types";
import { LiveDot, Pill, RiskStrip, useNow } from "./ui";
import { fmtCountdown, fmtUptime } from "@/lib/format";
import CarteraView from "./views/cartera";
import ConsensoView from "./views/consenso";
import DensidadView from "./views/densidad";
import AnalisisView from "./views/analisis";
import BallenasView from "./views/ballenas";
import RiesgoView from "./views/riesgo";
import CopyView from "./views/copy";

type ModuleId = "consenso" | "densidad" | "cartera" | "analisis" | "ballenas" | "riesgo" | "copy";

const MODULES: Array<{ id: ModuleId; label: string; icon: LucideIcon }> = [
  { id: "consenso", label: "Consenso", icon: Network },
  { id: "densidad", label: "Densidad", icon: BarChartHorizontal },
  { id: "cartera", label: "Cartera", icon: Wallet },
  { id: "analisis", label: "Análisis", icon: CandlestickChart },
  { id: "ballenas", label: "Ballenas", icon: Fish },
  { id: "riesgo", label: "Riesgo", icon: ShieldAlert },
  { id: "copy", label: "Copy", icon: Copy },
];

const STATE_STYLE: Record<EngineStateCode, { label: string; tone: "green" | "red" | "amber" | "cyan" | "zinc"; blink?: boolean }> = {
  IDLE: { label: "INACTIVO", tone: "zinc" },
  BOOTING: { label: "ARRANCANDO", tone: "amber" },
  SCANNING: { label: "ESCANEANDO", tone: "cyan" },
  IN_POSITION: { label: "EN POSICIÓN", tone: "green" },
  COOLDOWN: { label: "ENFRIAMIENTO", tone: "amber" },
  DAILY_HALT: { label: "FRENO DIARIO", tone: "red" },
  FATAL: { label: "FATAL", tone: "red", blink: true },
  STOPPED: { label: "DETENIDO", tone: "zinc" },
};

export default function Dashboard() {
  const [module, setModule] = useState<ModuleId>("cartera");
  const [data, setData] = useState<EnginePayload | null>(null);
  const [lastOkAt, setLastOkAt] = useState<number>(0);
  const [fetchError, setFetchError] = useState<string | null>(null);
  const [latencyMs, setLatencyMs] = useState<number | null>(null);
  const focusRef = useRef("BTCUSDT");
  const now = useNow(1000);

  useEffect(() => {
    let stop = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    async function tick() {
      const t0 = performance.now();
      try {
        const res = await fetch(
          `/api/engine/state?symbol=${encodeURIComponent(focusRef.current)}`,
          { cache: "no-store" },
        );
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const json = (await res.json()) as EnginePayload;
        if (!stop) {
          setData(json);
          setLastOkAt(Date.now());
          setLatencyMs(Math.round(performance.now() - t0));
          setFetchError(null);
        }
      } catch (err) {
        if (!stop) setFetchError(err instanceof Error ? err.message : String(err));
      } finally {
        if (!stop) timer = setTimeout(tick, 2000);
      }
    }
    void tick();
    return () => {
      stop = true;
      if (timer) clearTimeout(timer);
    };
  }, []);

  const online = lastOkAt > 0 && now - lastOkAt < 6_000;
  const engineState: EngineStateCode = data?.engine.state ?? "IDLE";
  const st = STATE_STYLE[engineState];
  const loopLag = data && data.engine.lastLoopAt ? data.now - data.engine.lastLoopAt : null;

  const selectSymbol = (s: string) => {
    focusRef.current = s;
    setModule((m) => (m === "densidad" || m === "analisis" ? m : m));
    setData((prev) =>
      prev ? { ...prev, market: { ...prev.market, focusSymbol: s } } : prev,
    );
  };

  return (
    <div className="bg-grid relative min-h-dvh">
      {/* ---------------------------------------------------------- header */}
      <header className="sticky top-0 z-40 border-b border-white/10 bg-[#04060a]/92 backdrop-blur">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-3 py-2.5">
          <div className="flex items-center gap-2.5">
            <div className="flex h-8 w-8 items-center justify-center border border-cyan-400/40 bg-cyan-400/10">
              <SquareTerminal className="h-4 w-4 text-cyan-300" />
            </div>
            <div>
              <div className="text-sm font-bold tracking-[0.22em] text-zinc-50">SCALP-OS</div>
              <div className="text-[8px] uppercase tracking-[0.28em] text-zinc-500">
                motor real · binance spot
              </div>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 border border-white/10 bg-white/[0.03] px-2 py-1 text-[9px] uppercase tracking-widest text-zinc-400">
              <LiveDot on={online} tone={online ? "green" : "red"} />
              {online ? "Online" : "Offline"}
            </span>
            <Pill tone={st.tone} blink={st.blink}>
              {st.label}
            </Pill>
          </div>
        </div>
        <div className="mx-auto flex max-w-5xl items-center justify-between border-t border-white/5 px-3 py-1 text-[8.5px] uppercase tracking-widest text-zinc-600">
          <span>
            uptime {data?.engine.bootedAt ? fmtUptime(now - data.engine.bootedAt) : "—"} · loops{" "}
            {data?.engine.loopCount ?? 0}
            {loopLag !== null ? ` · Δloop ${loopLag}ms` : ""}
          </span>
          <span>
            rtt {latencyMs !== null && online ? `${latencyMs}ms` : "—"}
            {" · "}
            {data?.streams.market.transport === "WS" && data.streams.market.connected
              ? "feed ws vivo"
              : "feed rest 2.5s"}
            {data ? ` · payload ${fmtCountdown(Math.max(0, 2000 - (now - lastOkAt)))}` : ""}
          </span>
        </div>
      </header>

      {/* ------------------------------------------------------------ main */}
      <main className="mx-auto max-w-5xl px-3 pb-40 pt-3">
        {!online && lastOkAt > 0 ? (
          <div className="mb-3 flex items-center gap-2 border border-red-500/40 bg-red-500/10 px-3 py-2 text-[10px] font-semibold uppercase tracking-widest text-red-300">
            <OctagonAlert className="h-3.5 w-3.5" />
            Terminal offline — reintentando cada 2s{fetchError ? ` · ${fetchError}` : ""}
          </div>
        ) : null}

        {data && data.engine.state === "FATAL" ? (
          <div className="scanline relative mb-3 border border-red-500/50 bg-red-950/30 px-3 py-3">
            <div className="flex items-center gap-2 text-[11px] font-bold uppercase tracking-[0.2em] text-red-400">
              <OctagonAlert className="h-4 w-4 animate-blink" />
              Motor detenido · estado fatal
            </div>
            <p className="mt-1 text-[10px] leading-relaxed text-red-300/90">
              {data.engine.fatalReason ?? "Fallo crítico sin descripción."}
            </p>
            <p className="mt-1 text-[9px] uppercase tracking-widest text-red-400/60">
              Cero simulación: el motor no operará hasta resolver la causa.
            </p>
          </div>
        ) : null}

        {data && data.errors.length > 0 ? (
          <div className="mb-3 border border-amber-500/30 bg-amber-500/5 px-3 py-1.5 text-[9px] uppercase tracking-widest text-amber-300/90">
            Secciones DB sin respuesta: {data.errors.join(" · ")} — no se muestran datos fabricados
          </div>
        ) : null}

        {!data ? (
          <div className="flex h-72 flex-col items-center justify-center gap-3 text-center">
            <SquareTerminal className="h-8 w-8 animate-pulse-dot text-cyan-400" />
            <div className="text-[10px] uppercase tracking-[0.3em] text-zinc-500">
              Enlazando con el motor SCALP-OS…
            </div>
            {fetchError ? (
              <div className="text-[9px] text-red-400">fallo de enlace: {fetchError}</div>
            ) : null}
          </div>
        ) : module === "consenso" ? (
          <ConsensoView data={data} onSelectSymbol={selectSymbol} />
        ) : module === "densidad" ? (
          <DensidadView data={data} onSelectSymbol={selectSymbol} />
        ) : module === "cartera" ? (
          <CarteraView data={data} />
        ) : module === "analisis" ? (
          <AnalisisView data={data} onSelectSymbol={selectSymbol} />
        ) : module === "ballenas" ? (
          <BallenasView data={data} />
        ) : module === "riesgo" ? (
          <RiesgoView data={data} />
        ) : (
          <CopyView data={data} />
        )}
      </main>

      {/* -------------------------------------------- footer: riesgo + nav */}
      <div className="fixed inset-x-0 bottom-0 z-50">
        <RiskStrip />
        <nav className="border-t border-white/10 bg-[#04060a]/95 backdrop-blur">
          <div className="mx-auto grid max-w-5xl grid-cols-7">
            {MODULES.map((m) => {
              const active = module === m.id;
              const Icon = m.icon;
              return (
                <button
                  key={m.id}
                  onClick={() => setModule(m.id)}
                  className={`relative flex flex-col items-center gap-0.5 py-2.5 pb-[calc(0.625rem+env(safe-area-inset-bottom))] transition-colors ${
                    active ? "text-cyan-300" : "text-zinc-600 hover:text-zinc-400"
                  }`}
                >
                  <span
                    className={`absolute top-0 h-0.5 w-8 transition-opacity ${
                      active ? "bg-cyan-300 opacity-100" : "opacity-0"
                    }`}
                  />
                  <Icon className="h-4 w-4" />
                  <span className="text-[7.5px] font-semibold uppercase tracking-[0.14em]">
                    {m.label}
                  </span>
                </button>
              );
            })}
          </div>
        </nav>
      </div>
    </div>
  );
}
