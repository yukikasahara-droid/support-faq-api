import pg from 'pg';

const { Pool } = pg;

export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  // 内部/ローカル前提。マネージドDBでTLSが要る場合は ssl を設定する。
});

/**
 * events テーブルを冪等に作成。
 * 列は各イベント種別で共通（未使用列は NULL）。将来の追加項目は meta(JSONB) に入れれば
 * マイグレーション不要で拡張できる。
 */
export async function ensureSchema(): Promise<void> {
  await pool.query(`
    create table if not exists events (
      id            bigserial primary key,
      created_at    timestamptz not null default now(),
      type          text        not null,
      session_id    text,
      query         text,
      result_count  integer,
      zero_result   boolean,
      article       text,
      position      integer,
      helpful       boolean,
      path          text,
      meta          jsonb       not null default '{}'::jsonb
    );
  `);
  await pool.query(
    `create index if not exists events_type_created_idx on events (type, created_at desc);`,
  );
  await pool.query(
    `create index if not exists events_query_idx on events (query) where query is not null;`,
  );
}
