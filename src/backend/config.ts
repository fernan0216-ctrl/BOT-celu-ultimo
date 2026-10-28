// ============================================================================
// SCALP-OS · Configuración central del motor (MODO REAL ESTRICTO)
// ============================================================================

const num = (v: string | undefined, d: number): number => {
  const n = v !== undefined ? Number(v) : NaN;
  return Number.isFinite(n) ? n : d;
};

export const ENGINE_CONFIG = {
  mode: "REAL" as const,
  quoteAsset: "USDT",

  // Estrategia scalp estricta
  takeProfitPct: num(process.env.SCALPOS_TP_PCT, 1.5) / 100, // +1.5% → venta
  stopLossPct: num(process.env.SCALPOS_SL_PCT, 1.0) / 100, // -1.0% → venta
  maxWaitMs: num(process.env.SCALPOS_MAX_WAIT_MS, 60_000), // anti-estancamiento 60s → venta a mercado

  // Bucle de alta frecuencia
  loopMs: 2_000, // bucle principal de gestión
  microLoopMs: 250, // micro-bucle de protección milisegundo a milisegundo

  // Sincronización de cartera
  minImportUsd: 5, // importar activos libres con valor > $5 USDT
  excludedAssets: ["USDT", "BNB"],

  // Entradas (Agente Gerente / Analista) — tamaño por operación configurable:
  // 10 USDT por defecto, con piso de seguridad de 5 USDT (minNotional real).
  perTradeUsdt: Math.max(5, num(process.env.SCALPOS_PER_TRADE_USDT, 10)),
  minSafetyUsdt: 5,
  maxOpenPositions: 2,
  postTradeCooldownMs: 15_000,
  maxDailyLossUsdt: num(process.env.SCALPOS_MAX_DAILY_LOSS_USDT, 25),
  entryScoreThreshold: num(process.env.SCALPOS_ENTRY_SCORE, 55),

  // User Data Stream
  listenKeyRenewMs: 30 * 60_000, // renovación automática cada 30 min

  // Observabilidad
  snapshotEveryMs: 30_000,
  whaleMinNotional: num(process.env.SCALPOS_WHALE_MIN_USDT, 25_000),
  watchlist: [
    "BTCUSDT",
    "ETHUSDT",
    "SOLUSDT",
    "XRPUSDT",
    "DOGEUSDT",
    "ADAUSDT",
    "LINKUSDT",
    "LTCUSDT",
  ],
};

export const BINANCE_API_KEY = (process.env.BINANCE_API_KEY ?? "").trim();
export const BINANCE_API_SECRET = (process.env.BINANCE_API_SECRET ?? "").trim();

const envHosts = (process.env.BINANCE_API_HOSTS ?? "")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

export const PRIVATE_REST_HOSTS = envHosts.length
  ? envHosts
  : [
      "https://api.binance.com",
      "https://api1.binance.com",
      "https://api2.binance.com",
      "https://api3.binance.com",
      "https://api4.binance.com",
    ];

// Espejo oficial de datos de mercado (público, sin firma) como último recurso
export const MARKET_REST_HOSTS = [...PRIVATE_REST_HOSTS, "https://data-api.binance.vision"];

export const WS_HOST = (process.env.BINANCE_WS_HOST ?? "wss://stream.binance.com:9443").trim();

export function utcDay(d = new Date()): string {
  return d.toISOString().slice(0, 10);
}
