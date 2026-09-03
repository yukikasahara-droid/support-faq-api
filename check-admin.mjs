const base = 'http://127.0.0.1:3001';
for (let i = 0; i < 20; i++) { try { const r = await fetch(base + '/health'); if (r.ok) break; } catch {} await new Promise((s) => setTimeout(s, 500)); }

const events = [
  { type: 'view', article: 'battery-drain', session_id: 'adm1', meta: { category: 'power' } },
  { type: 'view', article: 'wifi-connection', session_id: 'adm1', meta: { category: 'connection' } },
  { type: 'view', article: 'battery-drain', session_id: 'adm2', meta: { category: 'power' } },
  { type: 'feedback', article: 'battery-drain', helpful: false, session_id: 'adm1' },
  { type: 'search', query: 'テスト不足ワード', result_count: 0, zero_result: true, session_id: 'adm1' },
];
for (const e of events) await fetch(base + '/events', { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: JSON.stringify(e) });

const un = await fetch(base + '/admin');
console.log('GET /admin (no auth) ->', un.status, '| WWW-Authenticate:', un.headers.get('www-authenticate') || '(none)');

const cred = Buffer.from('admin:changeme_local').toString('base64');
const au = await fetch(base + '/admin', { headers: { Authorization: 'Basic ' + cred } });
const html = await au.text();
console.log('GET /admin (auth) ->', au.status, '| len =', html.length);
console.log('  ├─ title:', html.includes('管理ダッシュボード'));
console.log('  ├─ 記事別アクセス:', html.includes('記事別アクセス'));
console.log('  ├─ カテゴリ別アクセス:', html.includes('カテゴリ別アクセス'));
console.log('  └─ noindex:', html.includes('noindex'));

const bad = await fetch(base + '/admin', { headers: { Authorization: 'Basic ' + Buffer.from('admin:wrong').toString('base64') } });
console.log('GET /admin (wrong pass) ->', bad.status);
