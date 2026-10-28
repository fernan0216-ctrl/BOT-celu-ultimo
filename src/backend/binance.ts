// ============================================================================
// SCALP-OS · Cliente Binance Spot (REST firmado HMAC-SHA256 + WebSocket)
// Cero simulación: todas las respuestas provienen de los endpoints oficiales.
// ============================================================================
import crypto from "node:crypto";
import WebSocket from "ws";
import { PRIVATE_REST_HOSTS, MARKET_REST_HOSTS } from "./config";

// ---------------------------------------------------------------- Tipos REST
export interface BinanceBalance {
  asset: string;
  free: string;
  locked: string;
}

export interface BinanceAccount {
  makerCommission: number;
  takerCommission: number;
  canTrade: boolean;
  canWithdraw: boolean;
  canDeposit: boolean;
  balances: BinanceBalance[];
}

export interface BinanceFill {
  price: string;
  qty: string;
  commission: string;
  commissionAsset: string;
}

export interface BinanceOrderResponse {
  symbol: string;
  orderId: number;
  clientOrderId: string;
  transactTime: number;
  price: string;
  origQty: string;
  executedQty: string;
  cummulativeQuoteQty: string;
  status: string;
  type: string;
  side: string;
  fills?: BinanceFill[];
}

export interface BinanceListenKey {
  listenKey: string;
}

export interface BinanceTickerPrice {
  symbol: string;
  price: string;
}

export interface BinanceTicker24h {
  symbol: string;
  priceChangePercent: string;
  lastPrice: string;
  quoteVolume: string;
}

export type BinanceKlineRow = [
  number, string, string, string, string, string,
  number, string, number, string, string, string,
];

export interface BinanceDepthResponse {
  lastUpdateId: number;
  bids: [string, string][];
  asks: [string, string][];
}

export interface BinanceAggTrade {
  a: number; // aggregate trade id
  p: string; // price
  q: string; // qty
  f: number;
  l: number;
  T: number; // trade time
  m: boolean; // buyer is maker → presión vendedora
}

export interface LotFilter {
  stepSize: string;
  minQty: string;
  minNotional: number;
}

// ------------------------------------------------------- Eventos WS privados
export interface ExecutionReportEvent {
  e: "executionReport";
  E: number; // event time
  s: string; // symbol
  c: string; // client order id
  S: "BUY" | "SELL";
  o: string; // order type
  x: string; // execution type (NEW/TRADE/CANCELED...)
  X: string; // order status (FILLED/PARTIALLY_FILLED...)
  i: number; // order id
  l: string; // last executed qty
  L: string; // last executed price
  z: string; // cumulative filled qty
  Z: string; // cumulative quote qty
  T: number; // trade time
  q: string; // order qty
}

export interface OutboundAccountPositionEvent {
  e: "outboundAccountPosition";
  E: number;
  B: Array<{ a: string; f: string; l: string }>;
}

// ------------------------------------------------------------------- Errores
export class BinanceApiError extends Error {
  constructor(
    message: string,
    public readonly httpStatus: number,
    public readonly binanceCode: number | null,
  ) {
    super(message);
    this.name = "BinanceApiError";
  }
}

export function describeError(err: unknown): string {
  if (err instanceof BinanceApiError) {
    return err.binanceCode !== null
      ? `Binance ${err.binanceCode}: ${err.message} (HTTP ${err.httpStatus})`
      : `HTTP ${err.httpStatus}: ${err.message}`;
  }
  if (err instanceof Error) return `${err.name}: ${err.message}`;
  return String(err);
}

// ------------------------------------------------------------------ Utilidad
export function decimalsOf(step: string): number {
  const idx = step.indexOf("1");
  if (idx === -1) return 8;
  const dot = step.indexOf(".");
  return dot === -1 ? 0 : idx - dot;
}

export function floorToStep(qty: number, step: string): number {
  const s = Number(step);
  if (!Number.isFinite(s) || s <= 0) return qty;
  const floored = Math.floor(qty / s) * s;
  return Number(floored.toFixed(Math.min(12, decimalsOf(step) + 2)));
}

export function trimZeros(n: number): string {
  return n.toFixed(8).replace(/\.?0+$/, "");
}

// ------------------------------------------------------------ Cliente REST
export class BinanceRest {
  private timeOffsetMs = 0;
  private lastTimeSync = 0;
  private privateHostIdx = 0;
  private marketHostIdx = 0;
  private usedWeight = 0;
  private readonly lotCache = new Map<string, LotFilter>();

  constructor(
    private readonly apiKey: string,
    private readonly apiSecret: string,
  ) {}

  get weightPerMin(): number {
    return this.usedWeight;
  }

  private sign(qs: string): string {
    return crypto.createHmac("sha256", this.apiSecret).update(qs).digest("hex");
  }

  private async rawFetch(url: string, init: RequestInit, timeoutMs = 9_000): Promise<Response> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);
    try {
      const res = await fetch(url, { ...init, signal: controller.signal });
      const weight = res.headers.get("x-mbx-used-weight-1m");
      if (weight) this.usedWeight = Number(weight) || 0;
      return res;
    } finally {
      clearTimeout(timer);
    }
  }

  private async parseOrThrow<T>(res: Response): Promise<T> {
    const text = await res.text();
    if (!res.ok) {
      let code: number | null = null;
      let msg = text.slice(0, 240);
      try {
        const parsed = JSON.parse(text) as { code?: number; msg?: string };
        code = typeof parsed.code === "number" ? parsed.code : null;
        if (parsed.msg) msg = parsed.msg;
      } catch {
        /* cuerpo no-JSON */
      }
      throw new BinanceApiError(msg, res.status, code);
    }
    return JSON.parse(text) as T;
  }

  /** Recorre hosts ante fallos de red/geo (451/403/5xx). Errores lógicos 4xx → lanza. */
  private async hostWalk<T>(
    hosts: string[],
    sticky: "private" | "market",
    run: (host: string) => Promise<T>,
  ): Promise<T> {
    const start = sticky === "private" ? this.privateHostIdx : this.marketHostIdx;
    let lastErr: unknown = new Error("Sin hosts Binance configurados");
    for (let i = 0; i < hosts.length; i++) {
      const idx = (start + i) % hosts.length;
      try {
        const out = await run(hosts[idx]);
        if (sticky === "private") this.privateHostIdx = idx;
        else this.marketHostIdx = idx;
        return out;
      } catch (err) {
        lastErr = err;
        if (err instanceof BinanceApiError) {
          const walkable =
            err.httpStatus === 451 || err.httpStatus === 403 || err.httpStatus >= 500;
          if (!walkable) throw err; // credenciales inválidas, filtros, etc.
        }
        // errores de red / timeouts → probar siguiente host
      }
    }
    throw lastErr;
  }

  // ----------------------------------------------------------- Público mercado
  async marketGet<T>(path: string, params: Record<string, string | number> = {}): Promise<T> {
    return this.hostWalk(MARKET_REST_HOSTS, "market", async (host) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) q.set(k, String(v));
      const url = `${host}${path}${q.size ? `?${q.toString()}` : ""}`;
      const res = await this.rawFetch(url, { method: "GET" });
      return this.parseOrThrow<T>(res);
    });
  }

  async syncTime(): Promise<void> {
    const before = Date.now();
    const data = await this.marketGet<{ serverTime: number }>("/api/v3/time");
    this.timeOffsetMs = data.serverTime - Math.round((before + Date.now()) / 2);
    this.lastTimeSync = Date.now();
  }

  async getAllPrices(): Promise<Map<string, number>> {
    const rows = await this.marketGet<BinanceTickerPrice[]>("/api/v3/ticker/price");
    const map = new Map<string, number>();
    for (const r of rows) {
      const p = Number(r.price);
      if (Number.isFinite(p) && p > 0) map.set(r.symbol, p);
    }
    return map;
  }

  async getTicker24h(symbols: string[]): Promise<BinanceTicker24h[]> {
    return this.marketGet<BinanceTicker24h[]>("/api/v3/ticker/24hr", {
      symbols: JSON.stringify(symbols),
    });
  }

  async getKlines(symbol: string, interval: string, limit: number): Promise<BinanceKlineRow[]> {
    return this.marketGet<BinanceKlineRow[]>("/api/v3/klines", { symbol, interval, limit });
  }

  async getDepth(symbol: string, limit = 50): Promise<BinanceDepthResponse> {
    return this.marketGet<BinanceDepthResponse>("/api/v3/depth", { symbol, limit });
  }

  async getAggTrades(symbol: string, limit = 100): Promise<BinanceAggTrade[]> {
    return this.marketGet<BinanceAggTrade[]>("/api/v3/aggTrades", { symbol, limit });
  }

  async getLotFilter(symbol: string): Promise<LotFilter> {
    const cached = this.lotCache.get(symbol);
    if (cached) return cached;
    const rows = await this.marketGet<{ symbols: Array<{ symbol: string; filters: Array<Record<string, string>> }> }>(
      "/api/v3/exchangeInfo",
      { symbol },
    );
    const info = rows.symbols.find((s) => s.symbol === symbol);
    if (!info) throw new BinanceApiError(`Símbolo ${symbol} inexistente en exchangeInfo`, 400, -1121);
    let stepSize = "0.00000001";
    let minQty = "0";
    let minNotional = 5;
    for (const f of info.filters) {
      if (f.filterType === "LOT_SIZE") {
        stepSize = f.stepSize;
        minQty = f.minQty;
      }
      if (f.filterType === "NOTIONAL" || f.filterType === "MIN_NOTIONAL") {
        minNotional = Number(f.minNotional) || minNotional;
      }
    }
    const lot: LotFilter = { stepSize, minQty, minNotional };
    this.lotCache.set(symbol, lot);
    return lot;
  }

  // ------------------------------------------------------------------ Privado
  async signed<T>(
    method: "GET" | "POST" | "PUT" | "DELETE",
    path: string,
    params: Record<string, string | number> = {},
  ): Promise<T> {
    if (Date.now() - this.lastTimeSync > 3_600_000) {
      try {
        await this.syncTime();
      } catch {
        /* usa offset previo */
      }
    }
    return this.hostWalk(PRIVATE_REST_HOSTS, "private", async (host) => {
      const q = new URLSearchParams();
      for (const [k, v] of Object.entries(params)) q.set(k, String(v));
      q.set("timestamp", String(Date.now() + this.timeOffsetMs));
      q.set("recvWindow", "5000");
      q.set("signature", this.sign(q.toString()));
      const url = `${host}${path}?${q.toString()}`;
      const res = await this.rawFetch(url, {
        method,
        headers: { "X-MBX-APIKEY": this.apiKey },
      });
      return this.parseOrThrow<T>(res);
    });
  }

  getAccount(): Promise<BinanceAccount> {
    return this.signed<BinanceAccount>("GET", "/api/v3/account");
  }

  createMarketBuy(
    symbol: string,
    quoteOrderQty: string,
    clientOrderId?: string,
  ): Promise<BinanceOrderResponse> {
    const params: Record<string, string> = {
      symbol,
      side: "BUY",
      type: "MARKET",
      quoteOrderQty,
      newOrderRespType: "FULL",
    };
    if (clientOrderId) params.newClientOrderId = clientOrderId;
    return this.signed<BinanceOrderResponse>("POST", "/api/v3/order", params);
  }

  createMarketSell(
    symbol: string,
    quantity: string,
    clientOrderId?: string,
  ): Promise<BinanceOrderResponse> {
    const params: Record<string, string> = {
      symbol,
      side: "SELL",
      type: "MARKET",
      quantity,
      newOrderRespType: "FULL",
    };
    if (clientOrderId) params.newClientOrderId = clientOrderId;
    return this.signed<BinanceOrderResponse>("POST", "/api/v3/order", params);
  }

  // userDataStream: firma vía header X-MBX-APIKEY (sin HMAC)
  private async listenKeyRequest<T>(method: "POST" | "PUT" | "DELETE", params: Record<string, string> = {}): Promise<T> {
    return this.hostWalk(PRIVATE_REST_HOSTS, "private", async (host) => {
      const q = new URLSearchParams(params);
      const url = `${host}/api/v3/userDataStream${q.size ? `?${q.toString()}` : ""}`;
      const res = await this.rawFetch(url, {
        method,
        headers: { "X-MBX-APIKEY": this.apiKey },
      });
      if (res.status === 200 && method !== "POST") {
        return {} as T;
      }
      return this.parseOrThrow<T>(res);
    });
  }

  createListenKey(): Promise<BinanceListenKey> {
    return this.listenKeyRequest<BinanceListenKey>("POST");
  }

  keepAliveListenKey(listenKey: string): Promise<Record<string, never>> {
    return this.listenKeyRequest("PUT", { listenKey });
  }

  closeListenKey(listenKey: string): Promise<Record<string, never>> {
    return this.listenKeyRequest("DELETE", { listenKey });
  }
}

// ---------------------------------------------------- WebSocket con reconexión
export class ReconnectingWs {
  private ws: WebSocket | null = null;
  private closedByUser = false;
  private retryCount = 0;
  private reconnectTimer: NodeJS.Timeout | null = null;

  public connected = false;
  public lastMessageAt: number | null = null;
  public lastError: string | null = null;
  public reconnects = 0;

  constructor(
    private readonly urlProvider: () => string,
    private readonly onMessage: (raw: string) => void,
    private readonly onStateChange?: (connected: boolean) => void,
  ) {}

  start(): void {
    if (this.closedByUser) return;
    this.connect();
  }

  private connect(): void {
    let ws: WebSocket;
    try {
      ws = new WebSocket(this.urlProvider(), { handshakeTimeout: 10_000 });
    } catch (err) {
      this.lastError = describeError(err);
      this.scheduleReconnect();
      return;
    }
    this.ws = ws;
    ws.on("open", () => {
      this.connected = true;
      this.retryCount = 0;
      this.lastError = null;
      this.onStateChange?.(true);
    });
    ws.on("message", (data: WebSocket.RawData) => {
      this.lastMessageAt = Date.now();
      try {
        this.onMessage(data.toString());
      } catch {
        /* mensaje malformado → ignorar */
      }
    });
    ws.on("close", () => {
      this.teardown();
      if (!this.closedByUser) this.scheduleReconnect();
    });
    ws.on("error", (err: Error) => {
      this.lastError = err.message;
      try {
        ws.close();
      } catch {
        /* ya cerrado */
      }
    });
  }

  private scheduleReconnect(): void {
    this.reconnects += 1;
    const delay = Math.min(30_000, 1_000 * 2 ** Math.min(5, this.retryCount));
    this.retryCount += 1;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    this.reconnectTimer = setTimeout(() => this.connect(), delay);
  }

  private teardown(): void {
    if (this.connected) this.onStateChange?.(false);
    this.connected = false;
    this.ws = null;
  }

  stop(): void {
    this.closedByUser = true;
    if (this.reconnectTimer) clearTimeout(this.reconnectTimer);
    const ws = this.ws;
    this.teardown();
    try {
      ws?.close();
    } catch {
      /* noop */
    }
  }
}
