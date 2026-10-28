// ============================================================================
// SCALP-OS · GET /api/market/klines?symbol=BTCUSDT&interval=1m — velas reales
// de Binance Spot vía capa de mercado (caché ≤ 8s). Sin datos fabricados.
// ============================================================================
import { NextResponse } from "next/server";
import { getMarketData } from "@/backend/market-data";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

const INTERVALS = new Set(["1m", "5m", "15m", "1h"]);

export async function GET(req: Request): Promise<NextResponse> {
  const url = new URL(req.url);
  const symbol = (url.searchParams.get("symbol") ?? "BTCUSDT")
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, "")
    .slice(0, 20);
  const intervalRaw = url.searchParams.get("interval") ?? "1m";
  const interval = (INTERVALS.has(intervalRaw) ? intervalRaw : "1m") as "1m" | "5m" | "15m" | "1h";
  const limit = Math.min(200, Math.max(20, Number(url.searchParams.get("limit")) || 90));

  try {
    const candles = await getMarketData().getKlines(symbol, interval, limit);
    return NextResponse.json(
      { symbol, interval, candles, fetchedAt: Date.now(), source: "BINANCE_SPOT_LIVE" },
      { headers: { "Cache-Control": "no-store, max-age=0" } },
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return NextResponse.json(
      { symbol, interval, candles: [], fetchedAt: null, source: "BINANCE_SPOT_LIVE", error: msg },
      { status: 502, headers: { "Cache-Control": "no-store" } },
    );
  }
}
