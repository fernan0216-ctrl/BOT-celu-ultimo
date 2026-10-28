"use client";
// ============================================================================
// SCALP-OS · Módulo COPY — estado honesto: sin proveedor verificado conectado.
// MODO REAL ESTRICTO: no se muestran señales fabricadas.
// ============================================================================
import { Check, Copy as CopyIcon, Lock, X } from "lucide-react";
import type { EnginePayload } from "@/shared/types";
import { Panel, Pill } from "../ui";

export default function CopyView({ data }: { data: EnginePayload }) {
  const checks: Array<{ ok: boolean; label: string }> = [
    { ok: true, label: "Motor real verificado contra cuenta Binance" },
    { ok: false, label: "Proveedor de señales copy configurado (COPY_PROVIDER_URL)" },
    { ok: false, label: "Firma HMAC del proveedor validada" },
    { ok: false, label: "Track record auditado en scalpos_trades" },
  ];

  return (
    <div className="grid gap-3">
      <Panel
        title="Copy-trading · estado del módulo"
        right={
          <Pill tone="red" blink={data.engine.state !== "FATAL"}>
            Fuente no conectada
          </Pill>
        }
      >
        <div className="flex flex-col items-center gap-3 py-4 text-center">
          <div className="flex h-14 w-14 items-center justify-center border border-red-500/30 bg-red-500/5">
            <Lock className="h-6 w-6 text-red-400" />
          </div>
          <div>
            <div className="text-xs font-bold uppercase tracking-[0.2em] text-zinc-200">
              Módulo en espera — cero señales simuladas
            </div>
            <p className="mx-auto mt-2 max-w-[340px] text-[10px] leading-relaxed text-zinc-500">
              En MODO REAL ESTRICTO el módulo Copy no muestra traders, PnL ni rankings inventados.
              Se activará únicamente cuando exista un proveedor de señales configurado mediante{" "}
              <span className="text-zinc-300">COPY_PROVIDER_URL</span> con firma verificable y cada
              réplica se ejecute como orden real gestionada por el motor (TP +1.5% / SL −1.0% /
              MaxWait {data.config.maxWaitMs / 1000}s).
            </p>
          </div>
        </div>

        <div className="mt-2 space-y-1.5 border-t border-white/5 pt-3">
          {checks.map((c) => (
            <div key={c.label} className="flex items-center gap-2 text-[10px]">
              {c.ok ? (
                <Check className="h-3.5 w-3.5 text-emerald-400" />
              ) : (
                <X className="h-3.5 w-3.5 text-red-400" />
              )}
              <span className={c.ok ? "text-zinc-300" : "text-zinc-500"}>{c.label}</span>
            </div>
          ))}
        </div>

        <button
          disabled
          className="mt-4 flex w-full cursor-not-allowed items-center justify-center gap-2 border border-white/10 bg-white/[0.03] px-3 py-2.5 text-[10px] font-semibold uppercase tracking-[0.2em] text-zinc-600"
        >
          <CopyIcon className="h-3.5 w-3.5" />
          Conectar proveedor — requiere configuración
        </button>
      </Panel>
    </div>
  );
}
