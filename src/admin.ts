import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { createHash, timingSafeEqual } from 'node:crypto';
import { pool } from './db.js';

// 定数時間で比較（長さ差でも情報を漏らさないよう sha256 に通してから比較）
function safeEq(a: string, b: string): boolean {
  const ha = createHash('sha256').update(a).digest();
  const hb = createHash('sha256').update(b).digest();
  return timingSafeEqual(ha, hb);
}

// Basic 認証。ADMIN_USER / ADMIN_PASS（環境変数）と一致しなければ 401。
function authed(req: FastifyRequest, reply: FastifyReply): boolean {
  const user = process.env.ADMIN_USER;
  const pass = process.env.ADMIN_PASS;
  if (!user || !pass) {
    reply.code(503).type('text/plain; charset=utf-8').send('管理画面は無効です（ADMIN_USER / ADMIN_PASS 未設定）。');
    return false;
  }
  const header = req.headers.authorization ?? '';
  const m = /^Basic\s+(.+)$/i.exec(header);
  const challenge = 'Basic realm="Ory Support Admin", charset="UTF-8"';
  if (!m) {
    reply.header('WWW-Authenticate', challenge).code(401).type('text/plain; charset=utf-8').send('認証が必要です。');
    return false;
  }
  const [u, p] = Buffer.from(m[1], 'base64').toString('utf8').split(':');
  if (!safeEq(u ?? '', user) || !safeEq(p ?? '', pass)) {
    reply.header('WWW-Authenticate', challenge).code(401).type('text/plain; charset=utf-8').send('認証に失敗しました。');
    return false;
  }
  return true;
}

const esc = (s: unknown): string =>
  String(s ?? '').replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' })[c] as string);

const bar = (n: number, max: number): string => {
  const pct = max > 0 ? Math.round((n / max) * 100) : 0;
  return `<span class="bar"><span class="bar__fill" style="width:${pct}%"></span></span>`;
};

async function q<T = Record<string, unknown>>(sql: string): Promise<T[]> {
  const { rows } = await pool.query(sql);
  return rows as T[];
}

function table(headers: string[], rows: string[][], empty = 'データなし'): string {
  if (rows.length === 0) return `<p class="empty">${empty}</p>`;
  return `<table><thead><tr>${headers.map((h) => `<th>${h}</th>`).join('')}</tr></thead>` +
    `<tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>`;
}

async function renderDashboard(): Promise<string> {
  const since = "created_at > now() - interval '30 days'";
  const [views, cats, feedback, zero, top, noclick, totalsRows] = await Promise.all([
    q<{ article: string; n: number }>(`select article, count(*)::int n from events where type='view' and article is not null and ${since} group by article order by n desc limit 40`),
    q<{ cat: string; n: number }>(`select coalesce(meta->>'category','(不明)') cat, count(*)::int n from events where type='view' and ${since} group by cat order by n desc`),
    q<{ article: string; yes: number; no: number }>(`select article, count(*) filter (where helpful)::int yes, count(*) filter (where helpful is false)::int no from events where type='feedback' and article is not null group by article order by no desc, yes desc limit 40`),
    q<{ query: string; n: number }>(`select query, count(*)::int n from events where type='search' and zero_result and coalesce(query,'')<>'' and ${since} group by query order by n desc limit 25`),
    q<{ query: string; n: number }>(`select query, count(*)::int n from events where type='search' and coalesce(query,'')<>'' and ${since} group by query order by n desc limit 25`),
    q<{ query: string; n: number }>(`with s as (select distinct session_id, query from events where type='search' and coalesce(query,'')<>'' and coalesce(result_count,0)>0 and ${since}), c as (select distinct session_id, query from events where type='result_click') select s.query, count(*)::int n from s left join c on c.session_id=s.session_id and c.query=s.query where c.query is null group by s.query order by n desc limit 25`),
    q<{ views: number; searches: number; zero: number; feedback: number }>(`select count(*) filter (where type='view')::int views, count(*) filter (where type='search')::int searches, count(*) filter (where type='search' and zero_result)::int zero, count(*) filter (where type='feedback')::int feedback from events where ${since}`),
  ]);

  const totals = totalsRows[0] ?? { views: 0, searches: 0, zero: 0, feedback: 0 };
  const totalViews = views.reduce((s, r) => s + r.n, 0);
  const maxView = Math.max(1, ...views.map((r) => r.n));
  const maxCat = Math.max(1, ...cats.map((r) => r.n));

  const kpi = (label: string, value: number): string =>
    `<div class="kpi"><div class="kpi__v">${value.toLocaleString()}</div><div class="kpi__l">${label}</div></div>`;

  const viewRows = views.map((r) => {
    const pct = totalViews > 0 ? ((r.n / totalViews) * 100).toFixed(1) : '0.0';
    return [esc(r.article), String(r.n), `${bar(r.n, maxView)} <span class="pct">${pct}%</span>`];
  });
  const catRows = cats.map((r) => [esc(r.cat), String(r.n), bar(r.n, maxCat)]);
  const fbRows = feedback.map((r) => {
    const total = r.yes + r.no;
    const rate = total > 0 ? Math.round((r.yes / total) * 100) : 0;
    return [esc(r.article), `<span class="ok">${r.yes}</span>`, `<span class="bad">${r.no}</span>`, `${rate}%`];
  });
  const zeroRows = zero.map((r) => [esc(r.query), String(r.n)]);
  const topRows = top.map((r) => [esc(r.query), String(r.n)]);
  const noclickRows = noclick.map((r) => [esc(r.query), String(r.n)]);

  const now = new Date().toISOString().replace('T', ' ').slice(0, 16);

  return `<!doctype html><html lang="ja"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><meta name="robots" content="noindex, nofollow"><title>Ory Support 管理ダッシュボード</title>
<style>
  :root{--ink:#2b2928;--body:#4f4c4c;--muted:#8a8483;--bg:#faf9f8;--surface:#fff;--line:#e7e4e1;--green:#00806c;--red:#b23b3b;--grad:linear-gradient(90deg,#0e326f,#8484ac,#f08e4d)}
  *{box-sizing:border-box}
  body{margin:0;background:var(--bg);color:var(--body);font-family:"Noto Sans JP","Hiragino Kaku Gothic ProN",Meiryo,system-ui,sans-serif;line-height:1.7}
  .wrap{max-width:1040px;margin:0 auto;padding:1.5rem}
  .top{height:4px;background:var(--grad);border-radius:2px;margin-bottom:1.4rem}
  h1{font-size:1.4rem;color:var(--ink);margin:0}
  .sub{color:var(--muted);font-size:.85rem;margin:.2rem 0 1.4rem}
  .kpis{display:grid;grid-template-columns:repeat(4,1fr);gap:.8rem;margin-bottom:1.8rem}
  .kpi{background:var(--surface);border:1px solid var(--line);border-radius:12px;padding:1rem}
  .kpi__v{font-size:1.7rem;font-weight:700;color:var(--ink)}
  .kpi__l{font-size:.78rem;color:var(--muted)}
  section{background:var(--surface);border:1px solid var(--line);border-radius:14px;padding:1.1rem 1.3rem;margin-bottom:1.2rem}
  h2{font-size:1.05rem;color:var(--ink);margin:0 0 .2rem;display:flex;align-items:center;gap:.5rem}
  h2::before{content:"";width:3px;height:1em;background:var(--grad);border-radius:2px}
  .hint{color:var(--muted);font-size:.8rem;margin:0 0 .8rem}
  table{border-collapse:collapse;width:100%;font-size:.88rem}
  th,td{text-align:left;padding:.5rem .6rem;border-bottom:1px solid var(--line);vertical-align:middle}
  th{font-size:.72rem;letter-spacing:.06em;color:var(--muted);text-transform:uppercase}
  td:nth-child(2){font-variant-numeric:tabular-nums}
  .bar{display:inline-block;width:120px;height:8px;background:#eee;border-radius:4px;overflow:hidden;vertical-align:middle}
  .bar__fill{display:block;height:100%;background:var(--grad)}
  .pct{color:var(--muted);font-size:.8rem;margin-left:.4rem}
  .ok{color:var(--green);font-weight:700}.bad{color:var(--red);font-weight:700}
  .empty{color:var(--muted);font-size:.85rem;padding:.4rem 0}
  .cols{display:grid;grid-template-columns:1fr 1fr;gap:1.2rem}
  @media(max-width:720px){.kpis{grid-template-columns:1fr 1fr}.cols{grid-template-columns:1fr}}
  .note{color:var(--muted);font-size:.78rem;margin-top:1.5rem}
</style></head><body><div class="wrap">
  <div class="top"></div>
  <h1>Ory Support 管理ダッシュボード</h1>
  <p class="sub">直近30日の集計（${now} 時点）・管理者専用</p>

  <div class="kpis">
    ${kpi('記事閲覧', totals.views)}${kpi('検索', totals.searches)}${kpi('ゼロ件検索', totals.zero)}${kpi('評価', totals.feedback)}
  </div>

  <section>
    <h2>記事別アクセス</h2>
    <p class="hint">よく見られている記事（アクセス率＝全閲覧に占める割合）。</p>
    ${table(['記事', '閲覧', 'アクセス率'], viewRows)}
  </section>

  <section>
    <h2>カテゴリ別アクセス</h2>
    ${table(['カテゴリ', '閲覧', ''], catRows)}
  </section>

  <div class="cols">
    <section>
      <h2>ゼロ件検索</h2>
      <p class="hint">＝不足コンテンツ候補（次に書くべき記事）。</p>
      ${table(['検索ワード', '回数'], zeroRows)}
    </section>
    <section>
      <h2>検索されたのにクリックされない</h2>
      <p class="hint">＝タイトル/内容が刺さっていない候補。</p>
      ${table(['検索ワード', 'セッション'], noclickRows)}
    </section>
  </div>

  <div class="cols">
    <section>
      <h2>検索ワード 上位</h2>
      ${table(['検索ワード', '回数'], topRows)}
    </section>
    <section>
      <h2>記事別フィードバック</h2>
      <p class="hint">「いいえ」が多い記事＝改訂候補。</p>
      ${table(['記事', 'はい', 'いいえ', '満足率'], fbRows)}
    </section>
  </div>

  <p class="note">※ このページは Basic 認証で保護され、検索エンジンには載りません（noindex）。データは匿名の計測ログに基づきます。</p>
</div></body></html>`;
}

export function registerAdmin(app: FastifyInstance): void {
  app.get('/admin', async (req, reply) => {
    if (!authed(req, reply)) return reply;
    const html = await renderDashboard();
    reply
      .header('content-type', 'text/html; charset=utf-8')
      .header('cache-control', 'no-store, private')
      .header('x-robots-tag', 'noindex, nofollow')
      .send(html);
    return reply;
  });
}
