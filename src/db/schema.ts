// ============================================================================
// SCALP-OS · Esquema PostgreSQL estricto (Drizzle ORM · pg-core)
// MODO REAL ESTRICTO — todas las filas provienen de eventos reales del motor.
// ============================================================================
import {
  pgTable,
  uuid,
  text,
  integer,
  bigint,
  numeric,
  timestamp,
  jsonb,
  index,
} from "drizzle-orm/pg-core";

// -- Trades cerrados (ventas reales ejecutadas en Binance Spot) ---------------
export const scalposTrades = pgTable(
  "scalpos_trades",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: text("symbol").notNull(),
    asset: text("asset").notNull(),
    side: text("side").notNull().default("LONG"),
    quantity: numeric("quantity", { precision: 38, scale: 12 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 38, scale: 12 }).notNull(),
    exitPrice: numeric("exit_price", { precision: 38, scale: 12 }).notNull(),
    quoteQty: numeric("quote_qty", { precision: 38, scale: 12 }).notNull(),
    pnlUsdt: numeric("pnl_usdt", { precision: 38, scale: 12 }).notNull(),
    pnlPct: numeric("pnl_pct", { precision: 18, scale: 8 }).notNull(),
    entryOrderId: bigint("entry_order_id", { mode: "number" }),
    exitOrderId: bigint("exit_order_id", { mode: "number" }),
    closeReason: text("close_reason").notNull(),
    source: text("source").notNull(), // WALLET_SYNC | ENGINE_BUY
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" }).notNull(),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("scalpos_trades_closed_at_idx").on(t.closedAt)],
);

// -- Posiciones rastreadas (abiertas / cerradas / dust) -----------------------
export const scalposPositions = pgTable(
  "scalpos_positions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    symbol: text("symbol").notNull(),
    asset: text("asset").notNull(),
    qty: numeric("qty", { precision: 38, scale: 12 }).notNull(),
    entryPrice: numeric("entry_price", { precision: 38, scale: 12 }).notNull(),
    entryTime: timestamp("entry_time", { withTimezone: true, mode: "date" }).notNull(),
    source: text("source").notNull(),
    status: text("status").notNull().default("OPEN"), // OPEN | CLOSED | DUST | EXTERNAL
    entryOrderId: bigint("entry_order_id", { mode: "number" }),
    closeOrderId: bigint("close_order_id", { mode: "number" }),
    closeReason: text("close_reason"),
    closedAt: timestamp("closed_at", { withTimezone: true, mode: "date" }),
    openedAt: timestamp("opened_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("scalpos_positions_status_idx").on(t.status)],
);

// -- Snapshots de equity (curva de cartera) -----------------------------------
export const scalposEquitySnapshots = pgTable(
  "scalpos_equity_snapshots",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    equityUsdt: numeric("equity_usdt", { precision: 38, scale: 12 }).notNull(),
    freeUsdt: numeric("free_usdt", { precision: 38, scale: 12 }).notNull(),
    positionsValueUsdt: numeric("positions_value_usdt", {
      precision: 38,
      scale: 12,
    }).notNull(),
    openPositions: integer("open_positions").notNull().default(0),
    engineState: text("engine_state").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("scalpos_equity_created_idx").on(t.createdAt)],
);

// -- Logs del sistema (boot, gerente, ws, riesgo, fatal) ----------------------
export const scalposSystemLogs = pgTable(
  "scalpos_system_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    level: text("level").notNull(), // INFO | WARN | ERROR | FATAL | TRADE | WS
    tag: text("tag").notNull(),
    message: text("message").notNull(),
    meta: jsonb("meta").$type<Record<string, unknown>>(),
    createdAt: timestamp("created_at", { withTimezone: true, mode: "date" })
      .notNull()
      .defaultNow(),
  },
  (t) => [index("scalpos_logs_created_idx").on(t.createdAt)],
);

export type ScalposTradeRow = typeof scalposTrades.$inferSelect;
export type ScalposPositionRow = typeof scalposPositions.$inferSelect;
export type ScalposEquityRow = typeof scalposEquitySnapshots.$inferSelect;
export type ScalposLogRow = typeof scalposSystemLogs.$inferSelect;
