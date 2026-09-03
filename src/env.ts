// .env を読み込む副作用モジュール。
// server.ts / analyze.ts の「最初のimport」にすることで、db.ts が Pool を生成する前に
// 環境変数（DATABASE_URL 等）を確定させる。ESM は import を先に評価するため、
// この分離が無いと env 読み込みが後回しになり接続先がデフォルト(5432)になってしまう。
// compose 等 .env が無い環境では何もしない（process.env をそのまま使う）。
try {
  process.loadEnvFile();
} catch {
  /* .env が無い環境ではスキップ */
}
