// ============================================================================
// SCALP-OS · Servicio de datos de mercado (público, no requiere credenciales)
// Tickers/klines/depth/aggTrades vía WebSocket con conciliación REST periódica.
// ============================================================================
import { BinanceRest, ReconnectingWs, describeError, type BinanceAggTrade } from "./binance";
import { ENGINE_CONFIG, WS_HOST } from "./config";
import type {
  Candle,
  ConsensusItem,
  DepthPayload,
  DepthWall,
  WhalePayload,
} from "@/shared/types";

type Interval = "1m" | "5m" | "15m" | "1h";

interface PriceEntry {
  price: number;
  t: number;
}

interface WsCombinedEvent {
  stream: string;
  data: Record<string, unknown>;
}

export class MarketDataService {
  private readonly rest = new BinanceRest("", "");
  private started = false;

  private readonly prices = new Map<string, PriceEntry>();
  private pricesRevision = 0;
  private firstPricesResolve: (() => void) | null = null;
  private readonly readyPromise = new Promise<void>((res) => {
    this.firstPricesResolve = res;
  });

  private ws: ReconnectingWs | null = null;
  private readonly extras = new Set<string>();
  private wsReconnects = 0;

  private readonly ticker24h = new Map<string, { chgPct: number; quoteVol: number }>();
  private readonly klinesCache = new Map<string, { candles: Candle[]; fetchedAt: number }>();
  private readonly depthCache = new Map<string, { payload: DepthPayload; fetchedAt: number }>();
  private consensus: ConsensusItem[] = [];

  private readonly whales: WhalePayload[] = [];
  private readonly seenWhaleIds = new Set<string>();
  private whaleCursor = 0;

  public focusSymbol = "BTCUSDT";
  public lastError: string | null = null;

  // ------------------------------------------------------------------ arranque
  start(): void {
    if (this.started) return;
    this.started = true;
    void this.loopForever(() => this.pollPrices(), 2_500);
    void this.loopForever(() => this.pollTicker24h(), 45_000);
    void this.loopForever(() => this.computeConsensus(), 20_000);
    void this.loopForever(() => this.pollWhaleSnapshot(), 6_000);
    void this.loopForever(() => this.refreshDepth(), 4_000);
    this.openCombinedStream();
  }

  ready(): Promise<void> {
    return this.readyPromise;
  }

  private async loopForever(fn: () => Promise<void>, ms: number): Promise<void> {
    while (this.started) {
      try {
        await fn();
      } catch (err) {
        this.lastError = describeError(err);
      }
      await new Promise((r) => setTimeout(r, ms));
    }
  }

  // ------------------------------------------------------------------ símbolos
  ensureSymbols(symbols: string[]): void {
    let changed = false;
    for (const s of symbols) {
      if (!ENGINE_CONFIG.watchlist.includes(s) && !this.extras.has(s)) {
        this.extras.add(s);
        changed = true;
      }
    }
    if (changed && this.started) this.openCombinedStream(); // resuscripción
  }

  private streamSymbols(): string[] {
    return [...ENGINE_CONFIG.watchlist, ...this.extras];
  }

  setFocusSymbol(symbol: string): void {
    const clean = symbol.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 20);
    if (/USDT$/.test(clean)) this.focusSymbol = clean;
  }

  // --------------------------------------------------------------------- tick
  getPriceInfo(symbol: string): PriceEntry | null {
    return this.prices.get(symbol) ?? null;
  }

  getPrice(symbol: string): number | null {
    const e = this.prices.get(symbol);
    return e && e.price > 0 ? e.price : null;
  }

  async warmAllPrices(): Promise<Map<string, number>> {
    const map = await this.rest.getAllPrices();
    const now = Date.now();
    for (const [s, p] of map) this.prices.set(s, { price: p, t: now });
    this.pricesRevision += 1;
    this.firstPricesResolve?.();
    this.firstPricesResolve = null;
    return map;
  }

  private async pollPrices(): Promise<void> {
    await this.warmAllPrices();
  }

  private async pollTicker24h(): Promise<void> {
    const symbols = this.streamSymbols();
    const rows = await this.rest.getTicker24h(symbols);
    for (const r of rows) {
      this.ticker24h.set(r.symbol, {
        chgPct: Number(r.priceChangePercent) || 0,
        quoteVol: Number(r.quoteVolume) || 0,
      });
    }
  }

  // -------------------------------------------------------------------- klines
  async getKlines(symbol: string, interval: Interval, limit = 60): Promise<Candle[]> {
    const key = `${symbol}:${interval}:${limit}`;
    const cached = this.klinesCache.get(key);
    if (cached && Date.now() - cached.fetchedAt < 8_000) return cached.candles;
    const rows = await this.rest.getKlines(symbol, interval, limit);
    const candles: Candle[] = rows.map((k) => ({
      t: k[0],
      o: Number(k[1]),
      h: Number(k[2]),
      l: Number(k[3]),
      c: Number(k[4]),
      v: Number(k[5]),
    }));
    this.klinesCache.set(key, { candles, fetchedAt: Date.now() });
    return candles;
  }

  /** Momentum % sobre N velas cerradas (excluye la vela en formación). */
  private static momentum(candles: Candle[], span: number): number {
    if (candles.length < span + 1) return 0;
    const closed = candles.slice(-(span + 1), -1);
    const first = closed[0];
    const last = closed[closed.length - 1];
    if (!first || !last || first.o <= 0) return 0;
    return (last.c / first.o - 1) * 100;
  }

  private async computeConsensus(): Promise<void> {
    const items: ConsensusItem[] = [];
    for (const symbol of this.streamSymbols()) {
      try {
        const [k1, k5, k15] = await Promise.all([
          this.getKlines(symbol, "1m", 8),
          this.getKlines(symbol, "5m", 8),
          this.getKlines(symbol, "15m", 8),
        ]);
        const m1 = MarketDataService.momentum(k1, 3);
        const m5 = MarketDataService.momentum(k5, 3);
        const m15 = MarketDataService.momentum(k15, 3);
        const composite = 0.5 * m1 + 0.3 * m5 + 0.2 * m15;
        const score = Math.max(-100, Math.min(100, Math.round(Math.tanh(composite / 0.25) * 100)));
        const t24 = this.ticker24h.get(symbol) ?? { chgPct: 0, quoteVol: 0 };
        const liquid = t24.quoteVol >= 2_000_000;
        const bias: ConsensusItem["bias"] =
          score >= ENGINE_CONFIG.entryScoreThreshold && m1 > 0.08 && t24.chgPct > -8 && liquid
            ? "ENTRY_ZONE"
            : score >= 25
              ? "LONG"
              : score <= -25
                ? "AVOID"
                : "NEUTRAL";
        items.push({
          symbol,
          price: this.getPrice(symbol) ?? 0,
          chg24hPct: t24.chgPct,
          quoteVol24h: t24.quoteVol,
          m1,
          m5,
          m15,
          score,
          bias,
        });
      } catch {
        /* símbolo sin klines → se omite esta ronda */
      }
    }
    items.sort((a, b) => b.score - a.score);
    this.consensus = items;
  }

  getConsensus(): ConsensusItem[] {
    return this.consensus;
  }

  // --------------------------------------------------------------------- depth
  private async refreshDepth(): Promise<void> {
    await this.getDepth(this.focusSymbol);
  }

  async getDepth(symbol: string): Promise<DepthPayload> {
    const cached = this.depthCache.get(symbol);
    if (cached && Date.now() - cached.fetchedAt < 4_000) return cached.payload;
    const raw = await this.rest.getDepth(symbol, 50);
    const bids = raw.bids.map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    const asks = raw.asks.map(([p, q]) => [Number(p), Number(q)] as [number, number]);
    const bidVol = bids.reduce((acc, [p, q]) => acc + p * q, 0);
    const askVol = asks.reduce((acc, [p, q]) => acc + p * q, 0);
    const bestBid = bids[0]?.[0] ?? 0;
    const bestAsk = asks[0]?.[0] ?? 0;
    const walls: DepthWall[] = [
      ...bids
        .map(([price, qty]) => ({ side: "BID" as const, price, qty, notional: price * qty }))
        .filter((w) => w.notional >= 10_000)
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 3),
      ...asks
        .map(([price, qty]) => ({ side: "ASK" as const, price, qty, notional: price * qty }))
        .filter((w) => w.notional >= 10_000)
        .sort((a, b) => b.notional - a.notional)
        .slice(0, 3),
    ];
    const payload: DepthPayload = {
      symbol,
      bestBid,
      bestAsk,
      spreadPct: bestBid > 0 ? (bestAsk / bestBid - 1) * 100 : 0,
      bidVol,
      askVol,
      imbalancePct: bidVol + askVol > 0 ? ((bidVol - askVol) / (bidVol + askVol)) * 100 : 0,
      bids: bids.slice(0, 20),
      asks: asks.slice(0, 20),
      walls,
      updatedAt: Date.now(),
      source: this.ws?.connected ? "WS" : "REST",
    };
    this.depthCache.set(symbol, { payload, fetchedAt: Date.now() });
    return payload;
  }

  // -------------------------------------------------------------------- ballenas
  private registerAggTrade(symbol: string, trade: BinanceAggTrade): void {
    const id = `${symbol}:${trade.a}`;
    if (this.seenWhaleIds.has(id)) return;
    this.seenWhaleIds.add(id);
    if (this.seenWhaleIds.size > 20_000) this.seenWhaleIds.clear();
    const price = Number(trade.p);
    const qty = Number(trade.q);
    const notional = price * qty;
    if (!Number.isFinite(notional) || notional < ENGINE_CONFIG.whaleMinNotional) return;
    this.whales.unshift({
      id,
      symbol,
      side: trade.m ? "SELL" : "BUY",
      price,
      qty,
      notional,
      time: trade.T,
    });
    if (this.whales.length > 40) this.whales.length = 40;
  }

  private async pollWhaleSnapshot(): Promise<void> {
    const symbols = this.streamSymbols();
    const symbol = symbols[this.whaleCursor % symbols.length];
    this.whaleCursor += 1;
    const trades = await this.rest.getAggTrades(symbol, 100);
    for (const t of trades) this.registerAggTrade(symbol, t);
  }

  // ------------------------------------------------------------------------ WS
  private openCombinedStream(): void {
    this.ws?.stop();
    const symbols = this.streamSymbols();
    const streams = symbols
      .map((s) => s.toLowerCase())
      .flatMap((s) => [`${s}@miniTicker`, `${s}@aggTrade`])
      .join("/");
    this.ws = new ReconnectingWs(
      () => `${WS_HOST}/stream?streams=${streams}`,
      (raw) => this.onCombinedMessage(raw),
    );
    this.wsReconnects = 0;
    this.ws.start();
  }

  private onCombinedMessage(raw: string): void {
    const msg = JSON.parse(raw) as WsCombinedEvent;
    const symbol = String(msg.data.s ?? "");
    if (msg.stream.endsWith("@miniTicker")) {
      const price = Number(msg.data.c);
      if (symbol && Number.isFinite(price) && price > 0) {
        this.prices.set(symbol, { price, t: Date.now() });
        this.pricesRevision += 1;
      }
    } else if (msg.stream.endsWith("@aggTrade")) {
      const d = msg.data;
      this.registerAggTrade(symbol, {
        a: Number(d.a),
        p: String(d.p),
        q: String(d.q),
        f: 0,
        l: 0,
        T: Number(d.T),
        m: Boolean(d.m),
      });
    }
  }

  // ---------------------------------------------------------------------- salida
  getStreamsState() {
    return {
      connected: this.ws?.connected ?? false,
      transport: (this.ws?.connected ? "WS" : "REST") as "WS" | "REST",
      lastMsgAt: this.ws?.lastMessageAt ?? null,
      reconnects: this.ws?.reconnects ?? 0,
    };
  }

  getApiWeight(): number {
    return this.rest.weightPerMin;
  }

  getPublicState() {
    return {
      consensus: this.consensus,
      focusSymbol: this.focusSymbol,
      depth: this.depthCache.get(this.focusSymbol)?.payload ?? null,
      whales: [...this.whales],
      pricesRevision: this.pricesRevision,
    };
  }
}

// Instancia única anclada a globalThis (mismo motivo que el engine):
// evita duplicados entre el grafo de instrumentation.ts y el de las rutas.
const globalForMarket = globalThis as typeof globalThis & {
  __scalposMarket?: MarketDataService;
};

export const marketData = (globalForMarket.__scalposMarket ??
  new MarketDataService()) as MarketDataService;

globalForMarket.__scalposMarket = marketData;

export const getMarketData = (): MarketDataService => marketData;
