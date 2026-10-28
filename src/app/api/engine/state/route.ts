// ============================================================================
// SCALP-OS · GET /api/engine/state — snapshot completo del motor + mercado +
// PostgreSQL. Cero fabricación: cada sección fallida se declara en `errors`.
// ============================================================================
import { NextResponse } from "next/server";
import { getEngine } from "@/backend/engine";
import { getMarketData } from "@/backend/market-data";
import {
  getClosedTrades,
  getDailyPnlSeries,
  getEquitySeries,
  getRealizedStats,
  getRecentLogs,
} from "@/backend/queries";
import { ENGINE_CONFIG } from "@/backend/config";
import type { EnginePayload } from "@/shared/types";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(req: Request): Promise<NextResponse<EnginePayload>> {
  const url = new URL(req.url);
  const focus = url.searchParams.get("symbol");
  const market = getMarketData();
  market.start(); // idempotente: garantiza telemetría pública activa
  if (focus) market.setFocusSymbol(focus);

  const core = getEngine().getPublicState();
  const marketState = market.getPublicState();

  const [statsR, pnlR, equityR, tradesR, logsR] = await Promise.allSettled([
    getRealizedStats(),
    getDailyPnlSeries(7),
    getEquitySeries(96),
    getClosedTrades(15),
    getRecentLogs(40),
  ]);

  const errors: string[] = [];
  const stats = statsR.status === "fulfilled" ? statsR.value : null;
  const pnlSeries = pnlR.status === "fulfilled" ? pnlR.value : null;
  const equitySeries = equityR.status === "fulfilled" ? equityR.value : null;
  const trades = tradesR.status === "fulfilled" ? tradesR.value : null;
  const logsDb = logsR.status === "fulfilled" ? logsR.value : null;

  if (statsR.status === "rejected") errors.push("DB_STATS");
  if (pnlR.status === "rejected") errors.push("DB_PNL_SERIES");
  if (equityR.status === "rejected") errors.push("DB_EQUITY_SERIES");
  if (tradesR.status === "rejected") errors.push("DB_TRADES");
  if (logsR.status === "rejected") errors.push("DB_LOGS");

  const payload: EnginePayload = {
    now: core.now,
    engine: core.engine,
    config: {
      mode: ENGINE_CONFIG.mode,
      quoteAsset: ENGINE_CONFIG.quoteAsset,
      takeProfitPct: ENGINE_CONFIG.takeProfitPct,
      stopLossPct: ENGINE_CONFIG.stopLossPct,
      maxWaitMs: ENGINE_CONFIG.maxWaitMs,
      loopMs: ENGINE_CONFIG.loopMs,
      microLoopMs: ENGINE_CONFIG.microLoopMs,
      minImportUsd: ENGINE_CONFIG.minImportUsd,
      perTradeUsdt: ENGINE_CONFIG.perTradeUsdt,
      minSafetyUsdt: ENGINE_CONFIG.minSafetyUsdt,
      maxOpenPositions: ENGINE_CONFIG.maxOpenPositions,
      postTradeCooldownMs: ENGINE_CONFIG.postTradeCooldownMs,
      maxDailyLossUsdt: ENGINE_CONFIG.maxDailyLossUsdt,
      listenKeyRenewMs: ENGINE_CONFIG.listenKeyRenewMs,
      whaleMinNotional: ENGINE_CONFIG.whaleMinNotional,
      entryScoreThreshold: ENGINE_CONFIG.entryScoreThreshold,
      watchlist: ENGINE_CONFIG.watchlist,
      excludedAssets: ENGINE_CONFIG.excludedAssets,
    },
    streams: core.streams,
    wallet: core.wallet,
    positions: core.positions,
    // Prioridad a la fuente autoritativa (PostgreSQL). Si cae, se reporta la
    // lectura en memoria del motor (también real) con statsSource="ENGINE".
    stats: stats ?? core.stats,
    statsSource: stats ? "DB" : core.statsSource,
    pnlSeries,
    equitySeries,
    trades,
    logs: logsDb ?? core.logs,
    market: marketState,
    executions: core.executions,
    errors,
  };

  return NextResponse.json(payload, {
    headers: { "Cache-Control": "no-store, max-age=0" },
  });
}
