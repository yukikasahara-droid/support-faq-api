-- events テーブル（compose の Postgres 初回起動時に自動実行）。
-- API 側の ensureSchema() でも冪等に作成するため、どちらで立ち上げても同じ結果になる。
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

create index if not exists events_type_created_idx on events (type, created_at desc);
create index if not exists events_query_idx on events (query) where query is not null;
