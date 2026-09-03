# telemetry — 検索・クリック・フィードバックのログ収集

FAQサイトの「更新優先度づけ」に使う一次データ（検索語・ゼロ件検索・クリック・役立ち度）を貯める小さなAPI。
**Fastify + PostgreSQL**。常時起動は小箱1台（AWS Lightsail 想定）で、サイト本体（静的配信）とは独立。

> サイト本体は静的のまま。ブラウザから本APIへ"送るだけ"なので、配信基盤（GitHub Pages / S3+CF）を問わず動く。

## 収集するイベント

| type | 主な項目 | 分かること |
|---|---|---|
| `search` | `query` / `result_count` / `zero_result` | 何が検索されているか、**ゼロ件＝不足コンテンツ** |
| `result_click` | `query` / `article` / `position` | 検索の当たり/外れ、順位の妥当性 |
| `view` | `article` | よく見られる記事・導線 |
| `feedback` | `article` / `helpful` | 記事の質（改訂すべき記事） |

将来の追加項目は `meta`(JSONB) に入れればスキーマ変更不要。イベント種別を増やすときは `src/server.ts` の enum に足す。

## ローカルで動かす

```bash
# 1) Postgres を起動（healthy まで待つ）
docker compose up -d --wait db

# 2) 依存インストール（Node 22。Volta 利用者は自動）
npm install

# 3) API 起動（.env を読む）
npm run start        # http://localhost:3001

# 4) 動作確認
curl http://127.0.0.1:3001/health          # {"ok":true}
# 送信（text/plain の JSON。sendBeacon 互換）
curl -X POST http://127.0.0.1:3001/events -H "Content-Type: text/plain" \
  --data-raw '{"type":"search","query":"テスト","result_count":0,"zero_result":true}'

# 5) 優先度レポート
npm run analyze
```

または API もコンテナで一緒に起動: `docker compose up -d --wait`（`node:22-alpine` で動く）。

## エンドポイント

- `POST /events` … 単体イベント or 配列（最大20件）。`Content-Type: text/plain`（`sendBeacon` がプリフライトを避けるため）でも `application/json` でも可。成功時 `204`、不正 `400`。
- `GET /health` … `{"ok":true}`
- `GET /admin` … 管理ダッシュボード（Basic認証）。下記参照。

## 管理ダッシュボード `/admin`（管理者専用）

記事別アクセス・カテゴリ別アクセス・ゼロ件検索・「検索されたのにクリックされない語」・記事別フィードバックを、直近30日でHTML表示する。

- **Basic 認証**で保護（`ADMIN_USER` / `ADMIN_PASS`）。未設定なら `/admin` は無効（503）。
- `noindex` ＋ `Cache-Control: no-store`。ブラウザでURLを開くとログインを求められる。
- ローカル: `http://localhost:3001/admin`（`.env` の `ADMIN_USER=admin` / `ADMIN_PASS=changeme_local`）。
- 一般ユーザーは静的サイトから辿れない別オリジン＋認証保護なので、事実上到達不可。
- カテゴリ別は、閲覧イベントの `meta.category`（記事ページが付与）を集計する。

## サイト（フロント）との接続

サイト側のビルド環境変数に本APIのURLを設定すると、`src/lib/track.ts` の `track()` が送信を始める。

```
PUBLIC_TELEMETRY_ENDPOINT=https://telemetry.example.com/events
```

未設定なら `track()` は無効（サンプル公開やローカルでも壊れない）。

## 分析（Claudeから叩く）

- `npm run analyze` … ゼロ件検索・検索されたのにクリックされない語・改訂候補などを表で出力。
- `queries.sql` … 同等のSQL。psql / BI からも。
- Claude に分析させる場合は、DBへ**読み取り専用ユーザー**を作って接続情報を渡す（または `analyze` の出力を貼る）。

## プライバシー（顧客データのため最初から）

- **匿名の一時ID**（`session_id`、ランダム・アカウント非紐付け）で1セッション内の導線だけを繋ぐ。**個人情報・IPは保存しない**。
- 公開エンドポイントのため**レート制限**（既定 120 req/min・IP）。IPは判定に使うだけで保存しない。
- **保存期間**を決めて定期削除（例: 13か月）。cron や pg_cron で:
  ```sql
  delete from events where created_at < now() - interval '13 months';
  ```
- サイトに**プライバシー表記**（何を匿名収集するか）を掲載する。

## AWS Lightsail へのデプロイ（概要）

1. Lightsail インスタンス作成（Ubuntu, $5/月）。
2. Docker / Docker Compose を導入。
3. この `telemetry/` を配置し、`.env` を本番値に：
   - `POSTGRES_PASSWORD` を強固な値に
   - `ALLOWED_ORIGINS=https://（本番サイトのURL）`
4. `docker compose up -d --wait` で起動。データは名前付きボリューム `pgdata` に永続化。
5. **HTTPS 必須**（サイトがHTTPSのため、HTTPのAPIへはブラウザが送信をブロックする＝mixed content）。
   - サブドメイン（例 `telemetry.orylab.com`）をインスタンスに向け、**Caddy / nginx + Let's Encrypt** で TLS 終端（Caddy なら自動更新が楽）。
6. サイトのビルド環境変数に `PUBLIC_TELEMETRY_ENDPOINT=https://telemetry.orylab.com/events` を設定して再デプロイ。

> サーバレス（Lambda + DynamoDB/RDS 等）に載せ替えも可能。SQLでの分析と「自前DBを持てる分かりやすさ」を優先して、まずは Lightsail 構成にしている。
