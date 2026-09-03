// 直近のイベントを表示する簡易確認スクリプト（開発用）。実行: node check-recent.mjs
import pg from 'pg';
try { process.loadEnvFile(); } catch { /* .env 無し */ }
const p = new pg.Pool({
  connectionString: process.env.DATABASE_URL || 'postgres://telemetry:telemetry_local@localhost:5433/telemetry',
});
const r = await p.query(
  "select type, query, article, zero_result as zero, result_count as cnt, left(session_id,8) as sid, to_char(created_at,'HH24:MI:SS') as t from events order by created_at desc limit 12",
);
console.table(r.rows);
await p.end();
