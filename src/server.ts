import './env.js'; // 必ず最初に。他importより先に .env を読み込み、pool 生成前に環境変数を確定させる。
import Fastify from 'fastify';
import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import { z } from 'zod';
import { pool, ensureSchema } from './db.js';

const PORT = Number(process.env.PORT ?? 3001);
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS ?? 'http://localhost:4322')
  .split(',')
  .map((s) => s.trim())
  .filter(Boolean);

// 受け付けるイベント。将来の追加は enum に足すか、meta に入れる。
const EventSchema = z.object({
  type: z.enum(['search', 'result_click', 'view', 'feedback']),
  session_id: z.string().max(64).optional(),
  query: z.string().max(200).optional(),
  result_count: z.number().int().min(0).max(1_000_000).optional(),
  zero_result: z.boolean().optional(),
  article: z.string().max(200).optional(),
  position: z.number().int().min(0).max(100_000).optional(),
  helpful: z.boolean().optional(),
  path: z.string().max(300).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
});
const BodySchema = z.union([EventSchema, z.array(EventSchema).max(20)]);

const app = Fastify({ logger: true, trustProxy: true });

await app.register(cors, {
  origin: ALLOWED_ORIGINS.length ? ALLOWED_ORIGINS : true,
  methods: ['GET', 'POST'],
});
// 公開エンドポイントのため、いたずら送信をレート制限（IPは保存しない）。
await app.register(rateLimit, { max: 120, timeWindow: '1 minute' });

// sendBeacon は text/plain で飛ぶ（CORSプリフライト回避）。JSONとしてパースする。
app.addContentTypeParser('text/plain', { parseAs: 'string' }, (_req, body, done) => {
  try {
    done(null, body ? JSON.parse(body as string) : {});
  } catch {
    done(null, {}); // 壊れた本文は空にして 400 に落とす
  }
});

app.get('/health', async () => ({ ok: true }));

app.post('/events', async (req, reply) => {
  const parsed = BodySchema.safeParse(req.body);
  if (!parsed.success) {
    reply.code(400);
    return { error: 'invalid payload' };
  }
  const events = Array.isArray(parsed.data) ? parsed.data : [parsed.data];
  const client = await pool.connect();
  try {
    for (const e of events) {
      await client.query(
        `insert into events
           (type, session_id, query, result_count, zero_result, article, position, helpful, path, meta)
         values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [
          e.type,
          e.session_id ?? null,
          e.query ?? null,
          e.result_count ?? null,
          e.zero_result ?? null,
          e.article ?? null,
          e.position ?? null,
          e.helpful ?? null,
          e.path ?? null,
          JSON.stringify(e.meta ?? {}),
        ],
      );
    }
  } finally {
    client.release();
  }
  reply.code(204);
  return null;
});

await ensureSchema();
await app.listen({ port: PORT, host: '0.0.0.0' });
app.log.info(`telemetry API listening on :${PORT} (origins: ${ALLOWED_ORIGINS.join(', ') || '*'})`);
