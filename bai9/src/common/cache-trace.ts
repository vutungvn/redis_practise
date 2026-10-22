import type { Response } from 'express';

// Header X-Cache: product=HIT; stock=MISS; price=LIVE -> de quan sat tren Postman
export function writeCacheTrace(res: Response, trace: Record<string, string>) {
  res.setHeader(
    'X-Cache',
    Object.entries(trace)
      .map(([type, source]) => `${type}=${source}`)
      .join('; '),
  );
}
