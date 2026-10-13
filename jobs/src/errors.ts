/** One-line error text with the real cause (viem wraps RPC errors: the first line alone says "unknown RPC error"). */
export function errText(e: unknown): string {
  const parts: string[] = [];
  let cur: unknown = e;
  for (let i = 0; i < 5 && cur; i++) {
    const x = cur as { shortMessage?: string; details?: string; message?: string; cause?: unknown };
    const text = x.details || x.shortMessage || x.message?.split('\n')[0];
    if (text && !parts.includes(text)) parts.push(text);
    cur = x.cause;
  }
  return parts.join(' ← ').slice(0, 480) || String(e);
}
