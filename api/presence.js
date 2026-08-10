import { Redis } from '@upstash/redis';

const WINDOW_SEC = 75;

export default async function handler(req, res) {
  res.setHeader('Access-Control-Allow-Origin', '*');

  const id = req.query?.id;
  if (!id || typeof id !== 'string') {
    return res.status(400).json({ error: 'missing id' });
  }

  const url = process.env.UPSTASH_REDIS_REST_URL;
  const token = process.env.UPSTASH_REDIS_REST_TOKEN;

  if (!url || !token) {
    return res.status(503).json({ error: 'presence unavailable' });
  }

  const redis = new Redis({ url, token });
  const key = 'barberwala:presence';
  const now = Date.now();

  await redis.zadd(key, { score: now, member: id });
  await redis.zremrangebyscore(key, 0, now - WINDOW_SEC * 1000);

  const count = await redis.zcard(key);

  return res.status(200).json({ count });
}
