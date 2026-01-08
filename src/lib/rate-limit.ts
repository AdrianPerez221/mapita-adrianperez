const buckets = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(ip: string, { limit, windowMs }: { limit: number; windowMs: number }) {
  const now = Date.now();
  const b = buckets.get(ip);

  if (!b || now > b.resetAt) {
    buckets.set(ip, { count: 1, resetAt: now + windowMs });
    return { ok: true, remaining: limit - 1 };
  }

  if (b.count >= limit) return { ok: false, remaining: 0 };

  b.count += 1;
  buckets.set(ip, b);
  return { ok: true, remaining: limit - b.count };
}
