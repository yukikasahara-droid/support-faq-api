// 貯めたログから「次に書く/直す記事の優先度」を出すレポート。
// 実行: npm run analyze （Claudeもこの出力を読んで優先度づけを手伝えます）
import './env.js'; // 必ず最初に（.env 読み込みを pool 生成より前にする）
import { pool } from './db.js';

async function report(title: string, sql: string): Promise<void> {
  const { rows } = await pool.query(sql);
  console.log(`\n=== ${title} ===`);
  if (rows.length === 0) {
    console.log('(データなし)');
    return;
  }
  console.table(rows);
}

await report(
  '検索ワード 上位30（直近30日）',
  `select query as 検索ワード, count(*)::int as 回数
     from events
    where type = 'search' and coalesce(query, '') <> ''
      and created_at > now() - interval '30 days'
    group by query
    order by 回数 desc
    limit 30`,
);

await report(
  'ゼロ件だった検索 ＝ 不足コンテンツ候補（直近30日）',
  `select query as 検索ワード, count(*)::int as 回数
     from events
    where type = 'search' and zero_result and coalesce(query, '') <> ''
      and created_at > now() - interval '30 days'
    group by query
    order by 回数 desc
    limit 30`,
);

await report(
  '検索されたのにクリックされない語 ＝ 刺さっていない候補（直近30日）',
  `with searched as (
      select distinct session_id, query
        from events
       where type = 'search' and coalesce(query, '') <> ''
         and coalesce(result_count, 0) > 0
         and created_at > now() - interval '30 days'
   ), clicked as (
      select distinct session_id, query from events where type = 'result_click'
   )
   select s.query as 検索ワード, count(*)::int as セッション数
     from searched s
     left join clicked c on c.session_id = s.session_id and c.query = s.query
    where c.query is null
    group by s.query
    order by セッション数 desc
    limit 30`,
);

await report(
  'よく見られた記事 上位20（直近30日）',
  `select article as 記事, count(*)::int as 閲覧
     from events
    where type = 'view' and article is not null
      and created_at > now() - interval '30 days'
    group by article
    order by 閲覧 desc
    limit 20`,
);

await report(
  '「役に立たなかった」が多い記事 ＝ 改訂候補',
  `select article as 記事,
          count(*) filter (where helpful is false)::int as いいえ,
          count(*) filter (where helpful is true)::int as はい
     from events
    where type = 'feedback' and article is not null
    group by article
   having count(*) filter (where helpful is false) > 0
    order by いいえ desc
    limit 20`,
);

await pool.end();
