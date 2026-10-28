// ============================================================================
// SCALP-OS · Consultas tipadas Drizzle ORM → alimentan el dashboard con datos
// REALES persistidos (trades, PnL diario, equity, logs). Sin fallbacks falsos:
// si PostgreSQL falla, la ruta marca `errors` y el panel lo declara.
// ============================================================================
import { db } from "@/db";
import {
  scalposTrades,
  scalposPositions,
  scalposEquitySnapshots,
  scalposSystemLogs,
  type ScalposPositionRow,
} from "@/db/schema";
import { desc, eq, sql } from "drizzle-orm";
import type {
  EquityPoint,
  LogLevel,
  LogPayload,
  PnlDay,
  StatsPayload,
  TradePayload,
} from "@/shared/types";

// ----------------------------------------------------------- trades cerrados
export async function getClosedTrades(limit = 20): Promise<TradePayload[]> {
  const rows = await db
    .select()
    .from(scalposTrades)
    .orderBy(desc(scalposTrades.closedAt))
    .limit(limit);
  return rows.map((r) => ({
    id: r.id,
    symbol: r.symbol,
    qty: Number(r.quantity),
    entryPrice: Number(r.entryPrice),
    exitPrice: Number(r.exitPrice),
    pnlUsdt: Number(r.pnlUsdt),
    pnlPct: Number(r.pnlPct),
    reason: r.closeReason,
    source: r.source,
    openedAt: r.openedAt.toISOString(),
    closedAt: r.closedAt.toISOString(),
  }));
}

// --------------------------------------------------------------- PnL diario
export async function getDailyPnlSeries(days = 7): Promise<PnlDay[]> {
  const res = await db.execute(sql`
      SELECT to_char(date_trunc('day', closed_at AT TIME ZONE 'UTC'), 'YYYY-MM-DD') AS day,
             COALESCE(SUM(pnl_usdt), 0)::text AS pnl,
             COUNT(*)::int AS trades
      FROM scalpos_trades
      WHERE closed_at >= ((NOW() AT TIME ZONE 'UTC')::date - ${days - 1} * INTERVAL '1 day')
      GROUP BY 1
      ORDER BY 1 ASC
    `);
  const rows = res.rows as unknown as Array<{ day: string; pnl: string; trades: number }>;
  return rows.map((r) => ({ day: String(r.day), pnl: Number(r.pnl), trades: Number(r.trades) }));
}

// ---------------------------------------------------------- stats agregadas
export async function getRealizedStats(): Promise<StatsPayload> {
  const res = await db.execute(sql`
      SELECT COUNT(*)::int AS n,
             COUNT(*) FILTER (WHERE pnl_usdt > 0)::int AS wins,
             COUNT(*) FILTER (WHERE pnl_usdt <= 0)::int AS losses,
             COALESCE(SUM(pnl_usdt), 0)::text AS pnl_total,
             COALESCE(SUM(pnl_usdt) FILTER (
               WHERE (closed_at AT TIME ZONE 'UTC')::date = (NOW() AT TIME ZONE 'UTC')::date
             ), 0)::text AS pnl_today,
             COALESCE(AVG(pnl_pct), 0)::text AS avg_pct,
             MAX(pnl_usdt)::text AS best,
             MIN(pnl_usdt)::text AS worst
      FROM scalpos_trades
    `);
  interface StatsRow {
    n: number;
    wins: number;
    losses: number;
    pnl_total: string;
    pnl_today: string;
    avg_pct: string;
    best: string | null;
    worst: string | null;
  }
  const rows = res.rows as unknown as StatsRow[];
  const r = rows[0];
  if (!r) {
    return {
      closedTrades: 0,
      wins: 0,
      losses: 0,
      winRate: 0,
      realizedPnlTotal: 0,
      realizedPnlToday: 0,
      avgPnlPct: 0,
      bestPnlUsdt: 0,
      worstPnlUsdt: 0,
    };
  }
  const n = Number(r.n);
  const wins = Number(r.wins);
  return {
    closedTrades: n,
    wins,
    losses: Number(r.losses),
    winRate: n > 0 ? (wins / n) * 100 : 0,
    realizedPnlTotal: Number(r.pnl_total),
    realizedPnlToday: Number(r.pnl_today),
    avgPnlPct: Number(r.avg_pct),
    bestPnlUsdt: r.best !== null ? Number(r.best) : 0,
    worstPnlUsdt: r.worst !== null ? Number(r.worst) : 0,
  };
}

// ------------------------------------------------------------- curva equity
export async function getEquitySeries(limit = 96): Promise<EquityPoint[]> {
  const rows = await db
    .select()
    .from(scalposEquitySnapshots)
    .orderBy(desc(scalposEquitySnapshots.createdAt))
    .limit(limit);
  return rows
    .reverse()
    .map((r) => ({
      t: r.createdAt.toISOString(),
      equity: Number(r.equityUsdt),
      free: Number(r.freeUsdt),
    }));
}

// ------------------------------------------------------------------ logs
export async function getRecentLogs(limit = 40): Promise<LogPayload[]> {
  const rows = await db
    .select()
    .from(scalposSystemLogs)
    .orderBy(desc(scalposSystemLogs.createdAt))
    .limit(limit);
  return rows.map((r) => ({
    t: r.createdAt.getTime(),
    level: r.level as LogLevel,
    tag: r.tag,
    msg: r.message,
  }));
}

// ------------------------------------------------------ posiciones abiertas
export async function getOpenPositionRows(): Promise<ScalposPositionRow[]> {
  return db.select().from(scalposPositions).where(eq(scalposPositions.status, "OPEN"));
}
