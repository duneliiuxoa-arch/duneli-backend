// =============================================================
// routes/metrics.js — Real database intelligence API
// BigInt-safe: all Prisma raw results coerced to Number/String
// =============================================================
import { Router } from 'express';
import prisma from '../prisma/middleware/prismaClient.js';

const router = Router();

// Safe converter: BigInt → Number, everything else untouched
function safe(v) {
  if (v === null || v === undefined) return null;
  if (typeof v === 'bigint') return Number(v);
  if (v instanceof Date) return v.toISOString();
  return v;
}

// Deep-convert entire result row
function row(r) {
  if (!r) return null;
  const out = {};
  for (const [k, v] of Object.entries(r)) out[k] = safe(v);
  return out;
}

function rows(arr) {
  return Array.isArray(arr) ? arr.map(row) : [];
}

async function raw(sql) {
  try { return rows(await prisma.$queryRawUnsafe(sql)); }
  catch (e) { console.warn('[metrics] query failed:', e.message); return null; }
}

// ── GET /api/metrics ─────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const [
      dbSize, tableStats, indexStats, connStats,
      cacheStats, lockStats, txStats, bgwStats,
      replStats, slowQ, vacStats, sessionStats,
      tableCounts, auditToday,
    ] = await Promise.all([

      raw(`SELECT
            pg_size_pretty(pg_database_size(current_database())) AS size,
            pg_database_size(current_database())::float8 AS size_bytes`),

      raw(`SELECT
            relname AS table_name,
            n_live_tup::float8 AS live_rows,
            n_dead_tup::float8 AS dead_rows,
            CASE WHEN n_live_tup+n_dead_tup>0
              THEN ROUND(n_dead_tup::numeric/NULLIF(n_live_tup+n_dead_tup,0)*100,2)
              ELSE 0 END AS dead_ratio_pct,
            last_autovacuum, last_vacuum, last_autoanalyze, last_analyze,
            pg_size_pretty(pg_total_relation_size(quote_ident(relname))) AS total_size,
            pg_total_relation_size(quote_ident(relname))::float8 AS total_size_bytes,
            seq_scan::float8 AS seq_scan,
            idx_scan::float8 AS idx_scan,
            n_tup_ins::float8 AS inserts,
            n_tup_upd::float8 AS updates,
            n_tup_del::float8 AS deletes
          FROM pg_stat_user_tables
          ORDER BY total_size_bytes DESC LIMIT 20`),

      raw(`SELECT
            i.indexrelname AS index_name,
            i.relname AS table_name,
            i.idx_scan::float8 AS scans,
            i.idx_tup_read::float8 AS tuples_read,
            pg_size_pretty(pg_relation_size(i.indexrelid)) AS index_size,
            pg_relation_size(i.indexrelid)::float8 AS index_size_bytes,
            CASE WHEN i.idx_scan=0 AND t.n_live_tup>0 THEN true ELSE false END AS is_unused
          FROM pg_stat_user_indexes i
          JOIN pg_stat_user_tables t ON i.relname=t.relname
          ORDER BY i.idx_scan ASC, index_size_bytes DESC LIMIT 20`),

      raw(`SELECT
            count(*)::float8 AS total,
            count(*) FILTER(WHERE state='active')::float8 AS active,
            count(*) FILTER(WHERE state='idle')::float8 AS idle,
            count(*) FILTER(WHERE state='idle in transaction')::float8 AS idle_in_tx,
            count(*) FILTER(WHERE wait_event_type='Lock')::float8 AS waiting_on_lock,
            (SELECT setting::int FROM pg_settings WHERE name='max_connections') AS max_connections
          FROM pg_stat_activity WHERE datname=current_database()`),

      raw(`SELECT
            SUM(heap_blks_hit)::float8 AS heap_hit,
            SUM(heap_blks_read)::float8 AS heap_read,
            CASE WHEN SUM(heap_blks_hit)+SUM(heap_blks_read)>0
              THEN ROUND(SUM(heap_blks_hit)::numeric/
                   NULLIF(SUM(heap_blks_hit)+SUM(heap_blks_read),0)*100,2)
              ELSE NULL END AS cache_hit_ratio
          FROM pg_statio_user_tables`),

      raw(`SELECT
            count(*)::float8 AS total_locks,
            count(*) FILTER(WHERE NOT granted)::float8 AS waiting_locks,
            count(*) FILTER(WHERE mode='ExclusiveLock')::float8 AS exclusive_locks
          FROM pg_locks WHERE relation IS NOT NULL`),

      raw(`SELECT
            xact_commit::float8 AS commits,
            xact_rollback::float8 AS rollbacks,
            blks_read::float8 AS blks_read,
            blks_hit::float8 AS blks_hit,
            deadlocks::float8 AS deadlocks,
            temp_files::float8 AS temp_files,
            temp_bytes::float8 AS temp_bytes,
            CASE WHEN blks_read+blks_hit>0
              THEN ROUND(blks_hit::numeric/NULLIF(blks_read+blks_hit,0)*100,2)
              ELSE NULL END AS block_cache_hit_ratio,
            stats_reset
          FROM pg_stat_database WHERE datname=current_database()`),

      raw(`SELECT
            checkpoints_timed::float8 AS checkpoints_timed,
            checkpoints_req::float8 AS checkpoints_req,
            checkpoint_write_time::float8 AS checkpoint_write_time,
            checkpoint_sync_time::float8 AS checkpoint_sync_time,
            buffers_checkpoint::float8 AS buffers_checkpoint,
            buffers_clean::float8 AS buffers_clean,
            buffers_backend::float8 AS buffers_backend,
            buffers_alloc::float8 AS buffers_alloc
          FROM pg_stat_bgwriter`),

      raw(`SELECT
            client_addr::text AS client_addr,
            state,
            sync_state,
            write_lag::text AS write_lag,
            flush_lag::text AS flush_lag,
            replay_lag::text AS replay_lag
          FROM pg_stat_replication`),

      raw(`SELECT
            pid::float8 AS pid,
            EXTRACT(EPOCH FROM(now()-query_start))::float8 AS duration_seconds,
            LEFT(query,200) AS query,
            state,
            wait_event_type,
            wait_event
          FROM pg_stat_activity
          WHERE datname=current_database()
            AND state != 'idle'
            AND query_start IS NOT NULL
            AND (now()-query_start) > interval '1 second'
          ORDER BY duration_seconds DESC LIMIT 10`),

      raw(`SELECT
            relname AS table_name,
            last_autovacuum, last_vacuum,
            last_autoanalyze, last_analyze,
            n_dead_tup::float8 AS n_dead_tup,
            n_live_tup::float8 AS n_live_tup
          FROM pg_stat_user_tables
          ORDER BY COALESCE(last_autovacuum,last_vacuum) ASC NULLS FIRST LIMIT 10`),

      // sessions table removed (Supabase Auth handles sessions now)
      Promise.resolve(null),

      raw(`SELECT tbl, cnt::float8 AS cnt FROM (
            SELECT 'users'             AS tbl, COUNT(*) AS cnt FROM users
            UNION ALL SELECT 'topics',             COUNT(*) FROM topics
            UNION ALL SELECT 'chat_messages',      COUNT(*) FROM chat_messages
            UNION ALL SELECT 'topic_votes',        COUNT(*) FROM topic_votes
            UNION ALL SELECT 'post_views',         COUNT(*) FROM post_views
            UNION ALL SELECT 'post_likes',         COUNT(*) FROM post_likes
            UNION ALL SELECT 'meeting_attendees',  COUNT(*) FROM meeting_attendees
            UNION ALL SELECT 'audit_logs',         COUNT(*) FROM audit_logs
            UNION ALL SELECT 'meetings',           COUNT(*) FROM meetings
            UNION ALL SELECT 'posts',              COUNT(*) FROM posts
            UNION ALL SELECT 'topic_scores',       COUNT(*) FROM topic_scores
          ) t`),

      raw(`SELECT COUNT(*)::float8 AS count
           FROM audit_logs
           WHERE "createdAt" >= NOW() - INTERVAL '24 hours'`),
    ]);

    // ── Extract base values ──────────────────────────────────
    const conn      = connStats?.[0]  || null;
    const cache     = cacheStats?.[0] || null;
    const tx        = txStats?.[0]    || null;

    const cacheHit  = cache?.cache_hit_ratio  != null ? Number(cache.cache_hit_ratio)  : null;
    const maxConns  = conn?.max_connections   != null ? Number(conn.max_connections)   : 100;
    const totalC    = conn?.total             != null ? Number(conn.total)             : null;
    const commits   = tx?.commits             != null ? Number(tx.commits)             : null;
    const rollbacks = tx?.rollbacks           != null ? Number(tx.rollbacks)           : null;
    const deadlocks = tx?.deadlocks           != null ? Number(tx.deadlocks)           : null;
    const connUtil  = totalC != null ? parseFloat((totalC / maxConns * 100).toFixed(1)) : null;

    // ── Health score (weighted, 0–100) ───────────────────────
    // Components: cache hit (35%), conn utilisation (30%), deadlocks (20%), rollback rate (15%)
    let health = null;
    if (cacheHit !== null && connUtil !== null && deadlocks !== null) {
      const cacheScore = cacheHit;
      const connScore  = Math.max(0, 100 - connUtil);
      const deadScore  = deadlocks === 0 ? 100 : Math.max(0, 100 - deadlocks * 10);
      const rollScore  = commits != null && (commits + rollbacks) > 0
        ? Math.max(0, 100 - (rollbacks / (commits + rollbacks)) * 100) : 100;
      health = Math.round(
        cacheScore * 0.35 + connScore * 0.30 + deadScore * 0.20 + rollScore * 0.15
      );
    }

    // ── Indexes ──────────────────────────────────────────────
    const idxList = (indexStats || []).map(i => ({
      name:       i.index_name,
      table:      i.table_name,
      scans:      Number(i.scans),
      tuplesRead: Number(i.tuples_read),
      size:       i.index_size,
      sizeBytes:  Number(i.index_size_bytes),
      unused:     i.is_unused === true,
      status:     i.is_unused ? 'unused'
                : Number(i.scans) > 1000 ? 'optimal'
                : Number(i.scans) > 100  ? 'ok'
                : 'low-use',
    }));

    const indexEfficiency = idxList.length
      ? Math.round(idxList.filter(i => !i.unused).length / idxList.length * 100)
      : null;

    // ── Table counts map ─────────────────────────────────────
    const counts = {};
    (tableCounts || []).forEach(r => { if (r?.tbl) counts[r.tbl] = Number(r.cnt); });

    // ── Build response (fully JSON-serialisable) ─────────────
    res.json({
      ts: new Date().toISOString(),
      health,

      db: {
        size:      dbSize?.[0]?.size ?? null,
        sizeBytes: dbSize?.[0]?.size_bytes != null ? Number(dbSize[0].size_bytes) : null,
      },

      connections: conn ? {
        total:          Number(conn.total),
        active:         Number(conn.active),
        idle:           Number(conn.idle),
        idleInTx:       Number(conn.idle_in_tx),
        waitingOnLock:  Number(conn.waiting_on_lock),
        max:            maxConns,
        utilizationPct: connUtil,
      } : null,

      cache: cache ? {
        hitRatio:  cacheHit,
        heapHit:   Number(cache.heap_hit),
        heapRead:  Number(cache.heap_read),
      } : null,

      transactions: tx ? {
        commits,
        rollbacks,
        deadlocks,
        tempFiles:           Number(tx.temp_files),
        tempBytes:           Number(tx.temp_bytes),
        blockCacheHitRatio:  tx.block_cache_hit_ratio != null ? Number(tx.block_cache_hit_ratio) : null,
        statsReset:          tx.stats_reset ? new Date(tx.stats_reset).toISOString() : null,
      } : null,

      locks: lockStats?.[0] ? {
        total:     Number(lockStats[0].total_locks),
        waiting:   Number(lockStats[0].waiting_locks),
        exclusive: Number(lockStats[0].exclusive_locks),
      } : null,

      checkpoints: bgwStats?.[0] ? {
        timed:        Number(bgwStats[0].checkpoints_timed),
        requested:    Number(bgwStats[0].checkpoints_req),
        writeTimeMs:  Number(bgwStats[0].checkpoint_write_time),
        syncTimeMs:   Number(bgwStats[0].checkpoint_sync_time),
        buffersAlloc: Number(bgwStats[0].buffers_alloc),
      } : null,

      indexEfficiency,
      indexes: idxList,

      tables: (tableStats || []).map(t => ({
        name:        t.table_name,
        liveRows:    Number(t.live_rows),
        deadRows:    Number(t.dead_rows),
        deadRatio:   Number(t.dead_ratio_pct),
        size:        t.total_size,
        sizeBytes:   Number(t.total_size_bytes),
        seqScans:    Number(t.seq_scan),
        idxScans:    Number(t.idx_scan),
        inserts:     Number(t.inserts),
        updates:     Number(t.updates),
        deletes:     Number(t.deletes),
        lastVacuum:  t.last_autovacuum || t.last_vacuum || null,
        lastAnalyze: t.last_autoanalyze || t.last_analyze || null,
      })),

      replicas: (replStats || []).map(r => ({
        clientAddr: r.client_addr,
        state:      r.state,
        syncState:  r.sync_state,
        writeLag:   r.write_lag,
        flushLag:   r.flush_lag,
        replayLag:  r.replay_lag,
      })),

      slowQueries: (slowQ || []).map(q => ({
        pid:             Number(q.pid),
        durationSeconds: Number(q.duration_seconds || 0),
        query:           q.query,
        state:           q.state,
        waitEvent:       q.wait_event || null,
      })),

      sessions: sessionStats?.[0] ? {
        total:   Number(sessionStats[0].total_sessions),
        active:  Number(sessionStats[0].active_sessions),
        expired: Number(sessionStats[0].expired_sessions),
      } : null,

      vacuumStats: (vacStats || []).map(v => ({
        table:       v.table_name,
        deadTuples:  Number(v.n_dead_tup),
        liveTuples:  Number(v.n_live_tup),
        lastVacuum:  v.last_autovacuum || v.last_vacuum || null,
        lastAnalyze: v.last_autoanalyze || v.last_analyze || null,
      })),

      recordCounts:     counts,
      auditEventsToday: auditToday?.[0]?.count != null ? Number(auditToday[0].count) : null,
    });

  } catch (err) {
    console.error('[metrics] Fatal error:', err);
    res.status(500).json({ error: 'Metrics collection failed', detail: err.message });
  }
});

export default router;
