// ============================================================================
// SCALP-OS · Tipos compartidos (servidor → cliente). Sin dependencias Node.
// ============================================================================

export type EngineStateCode =
  | "IDLE"
  | "BOOTING"
  | "SCANNING"
  | "IN_POSITION"
  | "COOLDOWN"
  | "DAILY_HALT"
  | "FATAL"
  | "STOPPED";

export type PositionStatus = "OPEN" | "EXITING" | "DUST";
export type PositionSource = "WALLET_SYNC" | "ENGINE_BUY";
export type LogLevel = "INFO" | "WARN" | "ERROR" | "FATAL" | "TRADE" | "WS";

export interface PositionPayload {
  id: string;
  symbol: string;
  asset: string;
  qty: number;
  entryPrice: number;
  entryTime: number;
  deadline: number; // entryTime + maxWaitMs → countdown anti-estancamiento
  ageMs: number;
  currentPrice: number;
  priceFreshMs: number;
  valueUsdt: number;
  pnlPct: number;
  pnlUsdt: number;
  peakPnlPct: number;
  status: PositionStatus;
  source: PositionSource;
  sellAttempts: number;
}

export interface BalancePayload {
  asset: string;
  free: number;
  locked: number;
  valueUsdt: number;
}

export interface ExecutionPayload {
  orderId: number;
  symbol: string;
  side: string;
  execType: string;
  status: string;
  lastQty: number;
  lastPrice: number;
  cumQty: number;
  cumQuote: number;
  time: number;
}

export interface LogPayload {
  t: number;
  level: LogLevel;
  tag: string;
  msg: string;
}

export interface TradePayload {
  id: string;
  symbol: string;
  qty: number;
  entryPrice: number;
  exitPrice: number;
  pnlUsdt: number;
  pnlPct: number;
  reason: string;
  source: string;
  openedAt: string;
  closedAt: string;
}

export interface EquityPoint {
  t: string;
  equity: number;
  free: number;
}

export interface PnlDay {
  day: string;
  pnl: number;
  trades: number;
}

export interface StatsPayload {
  closedTrades: number;
  wins: number;
  losses: number;
  winRate: number;
  realizedPnlTotal: number;
  realizedPnlToday: number;
  avgPnlPct: number;
  bestPnlUsdt: number;
  worstPnlUsdt: number;
}

export interface ConsensusItem {
  symbol: string;
  price: number;
  chg24hPct: number;
  quoteVol24h: number;
  m1: number;
  m5: number;
  m15: number;
  score: number; // -100 .. +100
  bias: "ENTRY_ZONE" | "LONG" | "NEUTRAL" | "AVOID";
}

export interface DepthWall {
  side: "BID" | "ASK";
  price: number;
  qty: number;
  notional: number;
}

export interface DepthPayload {
  symbol: string;
  bestBid: number;
  bestAsk: number;
  spreadPct: number;
  bidVol: number;
  askVol: number;
  imbalancePct: number;
  bids: [number, number][];
  asks: [number, number][];
  walls: DepthWall[];
  updatedAt: number;
  source: "WS" | "REST";
}

export interface WhalePayload {
  id: string;
  symbol: string;
  side: "BUY" | "SELL";
  price: number;
  qty: number;
  notional: number;
  time: number;
}

export interface Candle {
  t: number;
  o: number;
  h: number;
  l: number;
  c: number;
  v: number;
}

export interface EngineConfigPayload {
  mode: "REAL";
  quoteAsset: string;
  takeProfitPct: number;
  stopLossPct: number;
  maxWaitMs: number;
  loopMs: number;
  microLoopMs: number;
  minImportUsd: number;
  perTradeUsdt: number;
  minSafetyUsdt: number;
  maxOpenPositions: number;
  postTradeCooldownMs: number;
  maxDailyLossUsdt: number;
  listenKeyRenewMs: number;
  whaleMinNotional: number;
  entryScoreThreshold: number;
  watchlist: string[];
  excludedAssets: string[];
}

export interface EnginePayload {
  now: number;
  engine: {
    state: EngineStateCode;
    fatalReason: string | null;
    bootedAt: number | null;
    uptimeMs: number;
    loopCount: number;
    lastLoopAt: number | null;
    cooldownUntil: number;
    dailyHaltDate: string | null;
  };
  config: EngineConfigPayload;
  streams: {
    market: {
      connected: boolean;
      transport: "WS" | "REST";
      lastMsgAt: number | null;
      reconnects: number;
    };
    user: {
      connected: boolean;
      renewals: number;
      lastEventAt: number | null;
      listenKeyAgeMs: number | null;
      lastError: string | null;
    };
  };
  wallet: {
    equityUsdt: number;
    freeUsdt: number;
    positionsValueUsdt: number;
    balances: BalancePayload[];
    syncedAt: number | null;
    apiWeightPerMin: number;
  };
  positions: PositionPayload[];
  stats: StatsPayload | null;
  statsSource: "DB" | "ENGINE";
  pnlSeries: PnlDay[] | null;
  equitySeries: EquityPoint[] | null;
  trades: TradePayload[] | null;
  logs: LogPayload[];
  market: {
    consensus: ConsensusItem[];
    focusSymbol: string;
    depth: DepthPayload | null;
    whales: WhalePayload[];
    pricesRevision: number;
  };
  executions: ExecutionPayload[];
  errors: string[];
}
