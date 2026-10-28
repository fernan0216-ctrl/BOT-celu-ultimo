// ============================================================================
// SCALP-OS · Motor Central de Scalping — MODO REAL ESTRICTO (CERO SIMULACIÓN)
// ----------------------------------------------------------------------------
// · boot() → syncWalletPositions() importa activos reales de la cuenta al
//   arranque (activos libres ≠ USDT/BNB con valor > $5) bajo custodia del
//   Agente Gerente para venta/rotación controlada.
// · User Data Stream (listenKey, renovación cada 30 min) indexa llenados
//   vía executionReport en tiempo real.
// · Bucle de alta frecuencia de 2s + micro-bucle de 250ms: Take Profit +1.5%,
//   Stop Loss −1.0%, Max Wait Time 60s → venta a mercado anti-estancamiento.
// · Si las credenciales fallan o no hay saldo operable → estado FATAL y stop.
// ============================================================================
import { randomUUID } from "node:crypto";
import { db } from "@/db";
import { scalposPositions, scalposTrades, scalposEquitySnapshots, scalposSystemLogs } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  BinanceRest,
  ReconnectingWs,
  BinanceApiError,
  describeError,
  floorToStep,
  trimZeros,
  type BinanceAccount,
  type ExecutionReportEvent,
  type OutboundAccountPositionEvent,
} from "./binance";
import { marketData } from "./market-data";
import { getRealizedStats, getOpenPositionRows } from "./queries";
import { ENGINE_CONFIG, BINANCE_API_KEY, BINANCE_API_SECRET, WS_HOST, utcDay } from "./config";
import type {
  EngineStateCode,
  ExecutionPayload,
  LogLevel,
  LogPayload,
  PositionSource,
  StatsPayload,
} from "@/shared/types";

export type CloseReason = "TAKE_PROFIT" | "STOP_LOSS" | "MAX_WAIT_ROTATION" | "EXTERNAL";

/**
 * Error de protección total del broker (BrokerFatal): credenciales inválidas,
 * región restringida o cuenta sin saldo operable. Siempre conduce a FATAL.
 */
export class BrokerFatalError extends Error {
  constructor(message: string) {
    super(`BROKER-FATAL · ${message}`);
    this.name = "BrokerFatalError";
  }
}

interface TrackedPosition {
  id: string;
  persisted: boolean;
  symbol: string;
  asset: string;
  qty: number;
  entryPrice: number;
  entryTime: number;
  currentPrice: number;
  priceAt: number;
  peakPnlPct: number;
  status: "OPEN" | "EXITING" | "DUST";
  source: PositionSource;
  sellAttempts: number;
  entryOrderId?: number;
  /** clientOrderId de la orden de salida propia → correlación vía executionReport */
  exitClientId?: string;
  exitReason?: CloseReason;
}

interface WalletBalance {
  free: number;
  locked: number;
  valueUsdt: number;
}

const zeroStats = (): StatsPayload => ({
  closedTrades: 0,
  wins: 0,
  losses: 0,
  winRate: 0,
  realizedPnlTotal: 0,
  realizedPnlToday: 0,
  avgPnlPct: 0,
  bestPnlUsdt: 0,
  worstPnlUsdt: 0,
});

export class BotEngine {
  // ------------------------------------------------------------- estado núcleo
  private state: EngineStateCode = "IDLE";
  private fatalReason: string | null = null;
  private bootedAt: number | null = null;
  private loopCount = 0;
  private lastLoopAt: number | null = null;

  private rest: BinanceRest | null = null;
  private readonly positions = new Map<string, TrackedPosition>();
  private readonly balances = new Map<string, WalletBalance>();
  private freeUsdt = 0;
  private walletSyncedAt: number | null = null;

  private stats: StatsPayload = zeroStats();
  private statsSource: "DB" | "ENGINE" = "ENGINE";

  private cooldownUntil = 0;
  private dailyHaltDate: string | null = null;

  // --------------------------------------------------------------- streams
  private userWs: ReconnectingWs | null = null;
  private listenKey: string | null = null;
  private listenKeyCreatedAt: number | null = null;
  private renewals = 0;
  private lastUserEventAt: number | null = null;

  // ----------------------------------------------------------------- timers
  private macroTimer: NodeJS.Timeout | null = null;
  private microTimer: NodeJS.Timeout | null = null;
  private renewTimer: NodeJS.Timeout | null = null;
  private macroBusy = false;
  private lastSnapshotAt = 0;
  private lastSoftSyncAt = 0;

  // ---------------------------------------------------------------- buffers
  private readonly logs: LogPayload[] = [];
  private readonly executions: ExecutionPayload[] = [];

  // ==========================================================================
  // ARRANQUE
  // ==========================================================================
  async boot(): Promise<void> {
    const g = globalThis as { __scalposBootLock?: boolean };
    if (g.__scalposBootLock) return;
    g.__scalposBootLock = true;
    if (this.state !== "IDLE") return;

    this.state = "BOOTING";
    this.logLine("INFO", "BOOT", "Arranque SCALP-OS · MODO REAL ESTRICTO · cero simulación");
    this.persistLog("INFO", "BOOT", "Engine boot() iniciado en modo real estricto");

    // Telemetría pública de mercado (no requiere llaves; opera en modo real)
    marketData.start();

    if (!BINANCE_API_KEY || !BINANCE_API_SECRET) {
      this.enterFatal(
        "BROKER-FATAL · Credenciales Binance ausentes: define BINANCE_API_KEY y BINANCE_API_SECRET. " +
          "Modo real estricto: el motor NO opera sin cuenta real verificada.",
      );
      return;
    }

    this.rest = new BinanceRest(BINANCE_API_KEY, BINANCE_API_SECRET);

    try {
      await this.rest.syncTime();
      await this.syncWalletPositions({ strict: true });
      await this.reconcilePersistedPositions();
      await this.refreshStatsFromDb();
      await this.startUserStream();
      await this.snapshotEquity();
      this.bootedAt = Date.now();
      this.startLoops();
      this.deriveState();
      this.logLine("INFO", "BOOT", `Motor ONLINE · ${this.positions.size} posición(es) bajo custodia`);
      this.persistLog("INFO", "BOOT", "Motor ONLINE en modo real", {
        openPositions: this.positions.size,
      });
    } catch (err) {
      this.enterFatal(describeError(err));
    }
  }

  // ==========================================================================
  // SINCRONIZACIÓN OBLIGATORIA DE CARTERA (importación de activos reales)
  // ==========================================================================
  async syncWalletPositions(opts: { strict: boolean } = { strict: false }): Promise<void> {
    const rest = this.rest;
    if (!rest) throw new Error("REST no inicializado");

    let acct: BinanceAccount;
    try {
      acct = await rest.getAccount();
    } catch (err) {
      if (err instanceof BinanceApiError) {
        if (err.httpStatus === 451) {
          throw new BrokerFatalError(
            "Binance respondió HTTP 451 (región restringida para trading). Despliega en una región permitida (p. ej. Render EU).",
          );
        }
        if (err.binanceCode === -2014 || err.binanceCode === -2015 || err.httpStatus === 401) {
          throw new BrokerFatalError(
            `Binance rechazó las credenciales (code ${err.binanceCode ?? err.httpStatus}). ` +
              "Modo real estricto: el engine se detiene.",
          );
        }
      }
      throw err;
    }

    const priceMap = await marketData.warmAllPrices();
    const skip = new Set(ENGINE_CONFIG.excludedAssets);

    this.balances.clear();
    let equity = 0;
    let freeUsdt = 0;
    for (const b of acct.balances) {
      const free = Number(b.free);
      const locked = Number(b.locked);
      if (free <= 0 && locked <= 0) continue;
      let value = 0;
      if (b.asset === "USDT") {
        value = free + locked;
        freeUsdt = free;
      } else {
        const px = priceMap.get(`${b.asset}USDT`);
        if (px) value = (free + locked) * px;
      }
      equity += value;
      this.balances.set(b.asset, { free, locked, valueUsdt: value });
    }
    this.freeUsdt = freeUsdt;
    this.walletSyncedAt = Date.now();

    if (equity < 1) {
      throw new BrokerFatalError(
        "Cuenta Binance sin saldo operable (equity < $1 USDT). Modo real estricto: protección total.",
      );
    }

    // Importar activos libres (> $5) a la memoria del motor → Agente Gerente
    let imported = 0;
    for (const b of acct.balances) {
      const asset = b.asset;
      if (skip.has(asset)) continue;
      const free = Number(b.free);
      if (free <= 0) continue;
      const symbol = `${asset}USDT`;
      const px = priceMap.get(symbol);
      if (!px) continue; // sin par USDT spot → no gestionable
      const value = free * px;
      if (value <= ENGINE_CONFIG.minImportUsd) continue;
      if (this.positions.has(symbol)) continue;

      const pos: TrackedPosition = {
        id: randomUUID(),
        persisted: false,
        symbol,
        asset,
        qty: free,
        entryPrice: px,
        entryTime: Date.now(),
        currentPrice: px,
        priceAt: Date.now(),
        peakPnlPct: 0,
        status: "OPEN",
        source: "WALLET_SYNC",
        sellAttempts: 0,
      };
      this.positions.set(symbol, pos);
      imported += 1;
      this.logLine(
        "WARN",
        "GERENTE",
        `Activo importado de cartera: ${symbol} · qty ${free} · $${value.toFixed(2)} → venta gestionada (TP/SL/MaxWait)`,
      );
      this.persistLog("WARN", "GERENTE", "Activo importado desde cartera para rotación", {
        symbol,
        qty: free,
        valueUsdt: value,
      });
      marketData.ensureSymbols([symbol]);
    }

    this.logLine(
      "INFO",
      "SYNC",
      `Cartera sincronizada · equity $${equity.toFixed(2)} · USDT libre $${freeUsdt.toFixed(2)} · importados ${imported}`,
    );
    if (!opts.strict) this.persistLog("INFO", "SYNC", "Resincronización periódica de cartera", { equity });
  }

  private async reconcilePersistedPositions(): Promise<void> {
    try {
      const rows = await getOpenPositionRows();
      for (const row of rows) {
        const mem = this.positions.get(row.symbol);
        if (mem && !mem.persisted) {
          mem.id = row.id;
          mem.persisted = true;
        } else if (!mem) {
          await db
            .update(scalposPositions)
            .set({ status: "EXTERNAL", closeReason: "EXTERNAL", closedAt: new Date() })
            .where(eq(scalposPositions.id, row.id));
        }
      }
    } catch (err) {
      this.logLine("WARN", "DB", `Reconciliación de posiciones no disponible: ${describeError(err)}`);
    }
    // Persistir las posiciones nuevas importadas
    for (const pos of this.positions.values()) {
      if (!pos.persisted) await this.persistPositionOpen(pos);
    }
  }

  private async persistPositionOpen(pos: TrackedPosition): Promise<void> {
    try {
      const inserted = await db
        .insert(scalposPositions)
        .values({
          symbol: pos.symbol,
          asset: pos.asset,
          qty: String(pos.qty),
          entryPrice: String(pos.entryPrice),
          entryTime: new Date(pos.entryTime),
          source: pos.source,
          status: "OPEN",
          entryOrderId: pos.entryOrderId ?? null,
        })
        .returning({ id: scalposPositions.id });
      if (inserted[0]) {
        pos.id = inserted[0].id;
        pos.persisted = true;
      }
    } catch (err) {
      this.logLine("WARN", "DB", `No se pudo persistir posición ${pos.symbol}: ${describeError(err)}`);
    }
  }

  // ==========================================================================
  // USER DATA STREAM (listenKey + renovación cada 30 min)
  // ==========================================================================
  private async startUserStream(): Promise<void> {
    const rest = this.rest;
    if (!rest) return;
    if (this.renewTimer) clearInterval(this.renewTimer);
    try {
      const { listenKey } = await rest.createListenKey();
      this.listenKey = listenKey;
      this.listenKeyCreatedAt = Date.now();
      this.userWs?.stop();
      this.userWs = new ReconnectingWs(
        () => `${WS_HOST}/ws/${this.listenKey}`,
        (raw) => this.onUserEvent(raw),
      );
      this.userWs.start();
      this.logLine("WS", "WS", `User Data Stream activo · listenKey …${listenKey.slice(-6)}`);
    } catch (err) {
      this.logLine("WS", "WS", `No se pudo abrir userDataStream: ${describeError(err)} · reintento 30s`);
      setTimeout(() => {
        if (this.state !== "FATAL" && this.state !== "STOPPED") void this.startUserStream();
      }, 30_000);
    }
    // Renovación automática cada 30 minutos
    this.renewTimer = setInterval(() => {
      void this.renewListenKey();
    }, ENGINE_CONFIG.listenKeyRenewMs);
  }

  private async renewListenKey(): Promise<void> {
    if (this.state === "FATAL" || this.state === "STOPPED") return;
    if (!this.rest || !this.listenKey) {
      await this.startUserStream();
      return;
    }
    try {
      await this.rest.keepAliveListenKey(this.listenKey);
      this.renewals += 1;
      this.logLine("WS", "WS", "listenKey renovado (keepalive 30 min)");
    } catch (err) {
      this.logLine("WS", "WS", `keepalive falló: ${describeError(err)} → regenerando listenKey`);
      await this.startUserStream();
    }
  }

  private onUserEvent(raw: string): void {
    let ev: { e?: string };
    try {
      ev = JSON.parse(raw) as { e?: string };
    } catch {
      return;
    }
    this.lastUserEventAt = Date.now();
    if (ev.e === "executionReport") {
      this.handleExecutionReport(ev as unknown as ExecutionReportEvent);
    } else if (ev.e === "outboundAccountPosition") {
      this.applyAccountBalances(ev as unknown as OutboundAccountPositionEvent);
    }
  }

  /**
   * Indexación instantánea de llenados vía executionReport + reseteo de
   * estados al instante (cierres confirmados por WS y órdenes muertas).
   */
  private handleExecutionReport(ev: ExecutionReportEvent): void {
    const payload: ExecutionPayload = {
      orderId: ev.i,
      symbol: ev.s,
      side: ev.S,
      execType: ev.x,
      status: ev.X,
      lastQty: Number(ev.l) || 0,
      lastPrice: Number(ev.L) || 0,
      cumQty: Number(ev.z) || 0,
      cumQuote: Number(ev.Z) || 0,
      time: ev.T,
    };
    this.executions.unshift(payload);
    if (this.executions.length > 40) this.executions.length = 40;

    const pos = this.positions.get(ev.s);

    // RESETEO INSTANTÁNEO: la orden de salida propia murió sin fill → liberar
    if (ev.X === "CANCELED" || ev.X === "EXPIRED" || ev.X === "REJECTED") {
      if (pos && pos.status === "EXITING" && pos.exitClientId === ev.c) {
        pos.status = "OPEN";
        pos.exitClientId = undefined;
        pos.exitReason = undefined;
        this.logLine(
          "WARN",
          "WS",
          `Orden de salida ${ev.X} vía executionReport → ${ev.s} reabierta en memoria`,
        );
      }
      return;
    }

    if (ev.x !== "TRADE" || ev.X !== "FILLED" || !pos) return;

    const z = Number(ev.z) || 0;
    const Z = Number(ev.Z) || 0;
    const exitPx = z > 0 && Z > 0 ? Z / z : Number(ev.L) || pos.currentPrice;
    const qty = z > 0 ? z : pos.qty;
    const quote = Z > 0 ? Z : qty * exitPx;

    if (ev.S === "SELL" && pos.status === "EXITING" && pos.exitClientId === ev.c) {
      // Confirmación WS de la venta propia (puede llegar antes que la respuesta REST)
      this.closePositionBook(pos, exitPx, qty, quote, pos.exitReason ?? "TAKE_PROFIT", ev.i);
      return;
    }

    if (ev.S === "SELL" && pos.status === "OPEN" && pos.exitClientId !== ev.c) {
      // Venta NO iniciada por el motor (manual/app externa) → cierre indexado vía WS
      this.logLine("WARN", "WS", `Venta EXTERNA detectada vía executionReport: ${ev.s} · orderId ${ev.i}`);
      this.closePositionBook(pos, exitPx, qty, quote, "EXTERNAL", ev.i);
    }
  }

  private applyAccountBalances(ev: OutboundAccountPositionEvent): void {
    for (const b of ev.B) {
      const free = Number(b.f) || 0;
      const locked = Number(b.l) || 0;
      const px = b.a === "USDT" ? 1 : marketData.getPrice(`${b.a}USDT`);
      const prev = this.balances.get(b.a);
      const valueUsdt = px ? (free + locked) * px : (prev?.valueUsdt ?? 0);
      this.balances.set(b.a, { free, locked, valueUsdt });
      if (b.a === "USDT") this.freeUsdt = free;
    }
    this.walletSyncedAt = Date.now();
  }

  // ==========================================================================
  // BUCLE DE ALTA FRECUENCIA (macro 2s) + PROTECCIÓN ms-a-ms (micro 250ms)
  // ==========================================================================
  private startLoops(): void {
    if (this.macroTimer) clearInterval(this.macroTimer);
    if (this.microTimer) clearInterval(this.microTimer);
    this.macroTimer = setInterval(() => {
      void this.macroTick();
    }, ENGINE_CONFIG.loopMs);
    this.microTimer = setInterval(() => {
      this.microTick();
    }, ENGINE_CONFIG.microLoopMs);
  }

  private microTick(): void {
    if (this.state === "FATAL" || this.state === "STOPPED" || this.state === "IDLE" || this.state === "BOOTING") return;
    this.evaluateExits();
  }

  private async macroTick(): Promise<void> {
    if (this.macroBusy) return;
    if (this.state === "FATAL" || this.state === "STOPPED" || this.state === "IDLE" || this.state === "BOOTING") return;
    this.macroBusy = true;
    this.loopCount += 1;
    this.lastLoopAt = Date.now();
    try {
      const now = Date.now();
      if (now - this.lastSoftSyncAt >= 60_000) {
        this.lastSoftSyncAt = now;
        await this.syncWalletPositions({ strict: false });
        await this.refreshStatsFromDb();
      }
      if (now - this.lastSnapshotAt >= ENGINE_CONFIG.snapshotEveryMs) {
        await this.snapshotEquity();
      }
      this.updateDailyHalt();
      await this.managerScan();
      this.evaluateExits(); // red de seguridad del micro-bucle
      this.deriveState();
    } catch (err) {
      this.logLine("WARN", "LOOP", `Error en bucle macro: ${describeError(err)}`);
    } finally {
      this.macroBusy = false;
    }
  }

  // ==========================================================================
  // EVALUACIÓN DE SALIDAS — TP +1.5% · SL −1.0% · MaxWait 60s → MERCADO
  // ==========================================================================
  private evaluateExits(): void {
    const now = Date.now();
    for (const pos of this.positions.values()) {
      if (pos.status !== "OPEN") continue;
      const info = marketData.getPriceInfo(pos.symbol);
      if (info && info.price > 0) {
        pos.currentPrice = info.price;
        pos.priceAt = info.t;
      }
      if (now - pos.priceAt > 10_000) continue; // sin precio fresco → no decidir
      if (pos.entryPrice <= 0) continue;

      const pnl = pos.currentPrice / pos.entryPrice - 1;
      if (pnl * 100 > pos.peakPnlPct) pos.peakPnlPct = pnl * 100;

      if (pnl >= ENGINE_CONFIG.takeProfitPct) {
        void this.executeExit(pos, "TAKE_PROFIT");
      } else if (pnl <= -ENGINE_CONFIG.stopLossPct) {
        void this.executeExit(pos, "STOP_LOSS");
      } else if (now - pos.entryTime >= ENGINE_CONFIG.maxWaitMs) {
        void this.executeExit(pos, "MAX_WAIT_ROTATION"); // anti-estancamiento 60s
      }
    }
  }

  private async executeExit(pos: TrackedPosition, reason: CloseReason): Promise<void> {
    if (pos.status === "EXITING") return;
    pos.status = "EXITING";
    const rest = this.rest;
    if (!rest) {
      pos.status = "OPEN";
      return;
    }
    try {
      const lot = await rest.getLotFilter(pos.symbol);
      let qty = floorToStep(pos.qty, lot.stepSize);
      let notional = qty * pos.currentPrice;
      if (qty <= 0 || notional < lot.minNotional) {
        qty = floorToStep(pos.qty, "0.00000001");
        notional = qty * pos.currentPrice;
        if (qty <= 0 || notional < lot.minNotional) {
          pos.status = "DUST";
          this.logLine(
            "WARN",
            "MOTOR",
            `${pos.symbol}: $${notional.toFixed(2)} < minNotional $${lot.minNotional} → DUST, fuera de rotación`,
          );
          this.persistLog("WARN", "MOTOR", "Posición marcada DUST por minNotional", {
            symbol: pos.symbol,
            notional,
          });
          return;
        }
      }
      this.logLine("INFO", "MOTOR", `SALIDA ${reason} · ${pos.symbol} · vendiendo ${qty} a MERCADO`);
      // clientOrderId propio → el executionReport del User Data Stream podrá
      // casar el fill de esta orden exacta incluso si llega antes que el REST.
      pos.exitReason = reason;
      pos.exitClientId = `scalpos-x-${randomUUID().replace(/-/g, "").slice(0, 20)}`;
      const res = await rest.createMarketSell(pos.symbol, trimZeros(qty), pos.exitClientId);
      const z = Number(res.executedQty) || 0;
      const Z = Number(res.cummulativeQuoteQty) || 0;
      if (z <= 0) throw new Error(`Orden de venta sin fill (status ${res.status})`);
      // Si el WS ya indexó el fill y cerró la posición, no duplicar asientos.
      if (this.positions.get(pos.symbol)?.status !== "EXITING") return;
      const exitPx = Z > 0 ? Z / z : pos.currentPrice;
      this.closePositionBook(pos, exitPx, z, Z, reason, res.orderId);
    } catch (err) {
      pos.status = "OPEN";
      pos.exitClientId = undefined;
      pos.exitReason = undefined;
      pos.sellAttempts += 1;
      if (this.handleOrderError(`VENTA ${pos.symbol}`, err)) return;
      this.logLine("ERROR", "MOTOR", `Fallo venta ${pos.symbol} (intento ${pos.sellAttempts}): ${describeError(err)}`);
      if (pos.sellAttempts >= 8) {
        pos.status = "DUST";
        this.persistLog("ERROR", "MOTOR", "8 intentos de venta fallidos → posición DUST", {
          symbol: pos.symbol,
        });
      }
    }
  }

  private closePositionBook(
    pos: TrackedPosition,
    exitPx: number,
    execQty: number,
    quoteQty: number,
    reason: CloseReason,
    closeOrderId: number,
  ): void {
    this.positions.delete(pos.symbol);
    const pnlUsdt = quoteQty - execQty * pos.entryPrice;
    const pnlPct = pos.entryPrice > 0 ? (exitPx / pos.entryPrice - 1) * 100 : 0;
    this.cooldownUntil = Date.now() + ENGINE_CONFIG.postTradeCooldownMs;

    this.logLine(
      "TRADE",
      "MOTOR",
      `VENTA REAL ${pos.symbol} · qty ${execQty} · avg $${exitPx} · PnL ${pnlUsdt >= 0 ? "+" : ""}${pnlUsdt.toFixed(4)} (${pnlPct >= 0 ? "+" : ""}${pnlPct.toFixed(2)}%) · ${reason}`,
    );
    this.persistLog("TRADE", "MOTOR", `Trade cerrado: ${pos.symbol}`, {
      reason,
      pnlUsdt,
      pnlPct,
      exitPx,
    });

    void db
      .insert(scalposTrades)
      .values({
        symbol: pos.symbol,
        asset: pos.asset,
        side: "LONG",
        quantity: String(execQty),
        entryPrice: String(pos.entryPrice),
        exitPrice: String(exitPx),
        quoteQty: String(quoteQty),
        pnlUsdt: String(pnlUsdt),
        pnlPct: String(pnlPct),
        entryOrderId: pos.entryOrderId ?? null,
        exitOrderId: closeOrderId,
        closeReason: reason,
        source: pos.source,
        openedAt: new Date(pos.entryTime),
        closedAt: new Date(),
      })
      .catch((err: unknown) =>
        this.logLine("WARN", "DB", `No se pudo persistir trade: ${describeError(err)}`),
      );

    if (pos.persisted) {
      void db
        .update(scalposPositions)
        .set({
          status: reason === "EXTERNAL" ? "EXTERNAL" : "CLOSED",
          closeReason: reason,
          closeOrderId,
          closedAt: new Date(),
        })
        .where(eq(scalposPositions.id, pos.id))
        .catch(() => undefined);
    }

    void this.refreshStatsFromDb();
    this.deriveState();
  }

  // ==========================================================================
  // AGENTE GERENTE — escaneo de entradas con consenso multi-timeframe real
  // ==========================================================================
  private async managerScan(): Promise<void> {
    if (this.state === "FATAL" || this.state === "STOPPED") return;
    const now = Date.now();
    if (now < this.cooldownUntil) return;
    if (this.dailyHaltDate === utcDay()) return;
    const openCount = [...this.positions.values()].filter((p) => p.status !== "DUST").length;
    if (openCount >= ENGINE_CONFIG.maxOpenPositions) return;
    // Piso de seguridad: jamás se ejecuta una orden por debajo de 5 USDT.
    if (this.freeUsdt < ENGINE_CONFIG.minSafetyUsdt) return;
    const rest = this.rest;
    if (!rest) return;

    const candidates = marketData
      .getConsensus()
      .filter((c) => c.bias === "ENTRY_ZONE" && !this.positions.has(c.symbol));
    if (candidates.length === 0) return;
    const best = candidates[0];

    // Tamaño fijo por operación (perTradeUsdt, default 10 USDT), capado al libre.
    const quoteQty = Math.min(ENGINE_CONFIG.perTradeUsdt, this.freeUsdt);
    if (quoteQty < ENGINE_CONFIG.minSafetyUsdt) return;

    this.logLine(
      "INFO",
      "GERENTE",
      `Señal de entrada ${best.symbol} · score ${best.score} · m1 ${best.m1.toFixed(2)}% · m5 ${best.m5.toFixed(2)}%`,
    );
    try {
      const buyClientId = `scalpos-b-${randomUUID().replace(/-/g, "").slice(0, 16)}`;
      const res = await rest.createMarketBuy(best.symbol, quoteQty.toFixed(2), buyClientId);
      const z = Number(res.executedQty) || 0;
      const Z = Number(res.cummulativeQuoteQty) || 0;
      if (z <= 0 || Z <= 0) {
        this.logLine("WARN", "GERENTE", `Compra ${best.symbol} sin fill inmediato (status ${res.status})`);
        return;
      }
      const px = Z / z;
      const pos: TrackedPosition = {
        id: randomUUID(),
        persisted: false,
        symbol: best.symbol,
        asset: best.symbol.replace(/USDT$/, ""),
        qty: z,
        entryPrice: px,
        entryTime: Date.now(),
        currentPrice: px,
        priceAt: Date.now(),
        peakPnlPct: 0,
        status: "OPEN",
        source: "ENGINE_BUY",
        sellAttempts: 0,
        entryOrderId: res.orderId,
      };
      this.positions.set(pos.symbol, pos);
      marketData.ensureSymbols([pos.symbol]);
      this.freeUsdt = Math.max(0, this.freeUsdt - Z);
      this.logLine("TRADE", "MOTOR", `COMPRA REAL ${pos.symbol} · qty ${z} · avg $${px} · total $${Z.toFixed(2)}`);
      this.persistLog("TRADE", "MOTOR", `Compra real: ${pos.symbol}`, { qty: z, avgPrice: px, quoteQty: Z });
      await this.persistPositionOpen(pos);
      this.deriveState();
    } catch (err) {
      this.handleOrderError(`COMPRA ${best.symbol}`, err);
    }
  }

  /** Devuelve true si el error es crítico de credenciales → FATAL. */
  private handleOrderError(action: string, err: unknown): boolean {
    if (
      err instanceof BinanceApiError &&
      (err.binanceCode === -2014 || err.binanceCode === -2015 || err.httpStatus === 401)
    ) {
      this.enterFatal(`Claves API rechazadas durante ${action}: ${describeError(err)}`);
      return true;
    }
    this.logLine("ERROR", "MOTOR", `Error en ${action}: ${describeError(err)}`);
    return false;
  }

  // ==========================================================================
  // RIESGO — freno diario por pérdida máxima
  // ==========================================================================
  private updateDailyHalt(): void {
    const today = utcDay();
    if (this.dailyHaltDate === today) return;
    let unrealized = 0;
    for (const pos of this.positions.values()) {
      unrealized += (pos.currentPrice - pos.entryPrice) * pos.qty;
    }
    const totalToday = this.stats.realizedPnlToday + unrealized;
    if (totalToday <= -ENGINE_CONFIG.maxDailyLossUsdt) {
      this.dailyHaltDate = today;
      this.logLine(
        "ERROR",
        "RIESGO",
        `Pérdida diaria $${totalToday.toFixed(2)} ≤ −$${ENGINE_CONFIG.maxDailyLossUsdt} → entradas suspendidas hasta 00:00 UTC`,
      );
      this.persistLog("ERROR", "RIESGO", "Freno diario por pérdida máxima activado", {
        pnlToday: totalToday,
      });
    }
  }

  private deriveState(): void {
    if (this.state === "FATAL" || this.state === "STOPPED" || this.state === "IDLE" || this.state === "BOOTING") return;
    const open = [...this.positions.values()].some((p) => p.status === "OPEN" || p.status === "EXITING");
    if (open) this.state = "IN_POSITION";
    else if (this.dailyHaltDate === utcDay()) this.state = "DAILY_HALT";
    else if (Date.now() < this.cooldownUntil) this.state = "COOLDOWN";
    else this.state = "SCANNING";
  }

  // ==========================================================================
  // ESTADO FATAL — detención estricta del motor
  // ==========================================================================
  private enterFatal(reason: string): void {
    if (this.state === "FATAL") return;
    this.state = "FATAL";
    this.fatalReason = reason;
    if (this.macroTimer) clearInterval(this.macroTimer);
    if (this.microTimer) clearInterval(this.microTimer);
    if (this.renewTimer) clearInterval(this.renewTimer);
    this.userWs?.stop();
    this.logLine("FATAL", "FATAL", `MOTOR DETENIDO: ${reason}`);
    this.persistLog("FATAL", "FATAL", reason);
  }

  // ==========================================================================
  // OBSERVABILIDAD
  // ==========================================================================
  private logLine(level: LogLevel, tag: string, msg: string): void {
    this.logs.unshift({ t: Date.now(), level, tag, msg });
    if (this.logs.length > 60) this.logs.length = 60;
  }

  private persistLog(level: LogLevel, tag: string, message: string, meta?: Record<string, unknown>): void {
    void db
      .insert(scalposSystemLogs)
      .values({ level, tag, message, meta: meta ?? null })
      .catch(() => undefined);
  }

  private async refreshStatsFromDb(): Promise<void> {
    try {
      this.stats = await getRealizedStats();
      this.statsSource = "DB";
    } catch {
      this.statsSource = "ENGINE";
    }
  }

  private async snapshotEquity(): Promise<void> {
    this.lastSnapshotAt = Date.now();
    const w = this.computeWalletLive();
    try {
      await db.insert(scalposEquitySnapshots).values({
        equityUsdt: String(w.equityUsdt),
        freeUsdt: String(w.freeUsdt),
        positionsValueUsdt: String(w.positionsValueUsdt),
        openPositions: this.positions.size,
        engineState: this.state,
      });
    } catch {
      /* tabla aún no migrada → siguiente ciclo */
    }
  }

  private computeWalletLive() {
    let equity = 0;
    let positionsValue = 0;
    const balances = [...this.balances.entries()]
      .map(([asset, b]) => {
        const px = asset === "USDT" ? 1 : marketData.getPrice(`${asset}USDT`);
        const valueUsdt = px ? (b.free + b.locked) * px : b.valueUsdt;
        if (this.positions.has(`${asset}USDT`)) positionsValue += valueUsdt;
        equity += valueUsdt;
        return { asset, free: b.free, locked: b.locked, valueUsdt };
      })
      .filter((b) => b.free > 0 || b.locked > 0)
      .sort((a, b) => b.valueUsdt - a.valueUsdt);
    return { equityUsdt: equity, freeUsdt: this.freeUsdt, positionsValueUsdt: positionsValue, balances };
  }

  getStats(): StatsPayload {
    return this.stats;
  }

  getLogs(): LogPayload[] {
    return this.logs;
  }

  getPublicState() {
    const now = Date.now();
    const w = this.computeWalletLive();
    const positions = [...this.positions.values()].map((pos) => {
      const valueUsdt = pos.qty * pos.currentPrice;
      const pnlPct = pos.entryPrice > 0 ? (pos.currentPrice / pos.entryPrice - 1) * 100 : 0;
      return {
        id: pos.id,
        symbol: pos.symbol,
        asset: pos.asset,
        qty: pos.qty,
        entryPrice: pos.entryPrice,
        entryTime: pos.entryTime,
        deadline: pos.entryTime + ENGINE_CONFIG.maxWaitMs,
        ageMs: now - pos.entryTime,
        currentPrice: pos.currentPrice,
        priceFreshMs: now - pos.priceAt,
        valueUsdt,
        pnlPct,
        pnlUsdt: valueUsdt - pos.qty * pos.entryPrice,
        peakPnlPct: pos.peakPnlPct,
        status: pos.status,
        source: pos.source,
        sellAttempts: pos.sellAttempts,
      };
    });

    return {
      now,
      engine: {
        state: this.state,
        fatalReason: this.fatalReason,
        bootedAt: this.bootedAt,
        uptimeMs: this.bootedAt ? now - this.bootedAt : 0,
        loopCount: this.loopCount,
        lastLoopAt: this.lastLoopAt,
        cooldownUntil: this.cooldownUntil,
        dailyHaltDate: this.dailyHaltDate,
      },
      streams: {
        market: marketData.getStreamsState(),
        user: {
          connected: this.userWs?.connected ?? false,
          renewals: this.renewals,
          lastEventAt: this.lastUserEventAt,
          listenKeyAgeMs: this.listenKeyCreatedAt ? now - this.listenKeyCreatedAt : null,
          lastError: this.userWs?.lastError ?? null,
        },
      },
      wallet: {
        equityUsdt: w.equityUsdt,
        freeUsdt: w.freeUsdt,
        positionsValueUsdt: w.positionsValueUsdt,
        balances: w.balances.slice(0, 30),
        syncedAt: this.walletSyncedAt,
        apiWeightPerMin: (this.rest?.weightPerMin ?? 0) + marketData.getApiWeight(),
      },
      positions,
      stats: this.stats,
      statsSource: this.statsSource as "DB" | "ENGINE",
      logs: this.logs,
      executions: [...this.executions],
    };
  }
}

// ============================================================================
// EXPORTS OBLIGATORIOS DEL MOTOR
// ----------------------------------------------------------------------------
// Las rutas API y el hook de instrumentación pueden evaluarse en grafos de
// módulos separados (Turbopack): la instancia se ancla a globalThis para que
// exista exactamente UN motor por proceso, igual que el pool de PostgreSQL.
// ============================================================================
const globalForEngine = globalThis as typeof globalThis & {
  __scalposEngine?: BotEngine;
};

export const engine = (globalForEngine.__scalposEngine ??
  new BotEngine()) as BotEngine;

globalForEngine.__scalposEngine = engine;

export const getEngine = () => engine;

export const startEngine = () => engine.boot();
