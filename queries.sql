-- 更新優先度づけに使う分析クエリ集（psql や BI から実行。npm run analyze でも同じ内容が出る）。

-- 1) 検索ワード 上位（直近30日）
select query, count(*) as n
from events
where type = 'search' and coalesce(query,'') <> ''
  and created_at > now() - interval '30 days'
group by query order by n desc limit 30;

-- 2) ゼロ件だった検索 ＝ 不足コンテンツ候補
select query, count(*) as n
from events
where type = 'search' and zero_result and coalesce(query,'') <> ''
  and created_at > now() - interval '30 days'
group by query order by n desc limit 30;

-- 3) 検索されたのにクリックされない語 ＝ タイトル/内容が刺さっていない候補
with searched as (
  select distinct session_id, query
  from events
  where type = 'search' and coalesce(query,'') <> '' and coalesce(result_count,0) > 0
    and created_at > now() - interval '30 days'
), clicked as (
  select distinct session_id, query from events where type = 'result_click'
)
select s.query, count(*) as sessions
from searched s
left join clicked c on c.session_id = s.session_id and c.query = s.query
where c.query is null
group by s.query order by sessions desc limit 30;

-- 4) よく見られた記事 上位（直近30日）
select article, count(*) as views
from events
where type = 'view' and article is not null
  and created_at > now() - interval '30 days'
group by article order by views desc limit 20;

-- 5) 「役に立たなかった」が多い記事 ＝ 改訂候補
select article,
       count(*) filter (where helpful is false) as no,
       count(*) filter (where helpful is true)  as yes
from events
where type = 'feedback' and article is not null
group by article
having count(*) filter (where helpful is false) > 0
order by no desc limit 20;

-- 6) 日次のイベント数（動いているかの確認）
select date_trunc('day', created_at) as day, type, count(*) as n
from events
group by day, type order by day desc, type;
