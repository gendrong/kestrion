/**
 * Optional plain-language summary (CLAUDE.md §7): 2–3 sentences written by Gemini from the check JSON only.
 * It never changes the score, is cached per scan (scans.ai_summary) and is off without GEMINI_API_KEY.
 * API: POST https://generativelanguage.googleapis.com/v1beta/models/{model}:generateContent
 * (https://ai.google.dev/api/generate-content, checked 2026-10-13). Default model: gemini-3.5-flash-lite, listed
 * as "fastest, most cost-effective" for new projects (https://ai.google.dev/gemini-api/docs/models).
 */
import type { ScanReport } from '@kestrion/engine';

const MODEL = process.env.GEMINI_MODEL?.trim() || 'gemini-3.5-flash-lite';
/** Summaries per job run (keeps well inside free-tier request limits). */
export const AI_SUMMARIES_PER_RUN = 10;

const SYSTEM = [
  'You summarise a token risk report for crypto traders in 2 or 3 short, plain sentences.',
  'Use ONLY facts and numbers present in the JSON. Never add facts, guesses, prices, predictions or context.',
  'Start with the score and label. Then name the main reasons points were deducted, with their numbers.',
  'If checks are "unknown", say they could not be checked.',
  'Be factual and neutral: never accuse anyone, never use the words scam, rug, rugpull or fraud,',
  'and never tell the reader to buy, sell, hold, invest or avoid anything. No emojis, no markdown.',
].join(' ');

/** Words that must never appear (tone rules, CLAUDE.md §1 and §12). A summary containing one is discarded. */
const BANNED = /\b(scam\w*|rug\w*|fraud\w*|buy|sell|invest\w*|moon\w*|guarantee\w*|financial advice|ape in|avoid)\b/i;

let used = 0;

function compact(report: ScanReport) {
  return {
    token: `${report.token.name} ($${report.token.symbol})`,
    score: report.score,
    label: report.label,
    scanDepth: report.scanDepth ?? 'full',
    checks: report.checks.map((c) => ({ check: c.title, status: c.status, pointsDeducted: c.deduction, explanation: c.explanation })),
  };
}

/** The summary, or null (feature off, run quota used, API error, or the text broke a rule). */
export async function aiSummary(report: ScanReport): Promise<string | null> {
  const key = process.env.GEMINI_API_KEY?.trim();
  if (!key || used >= AI_SUMMARIES_PER_RUN) return null;
  used++;
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-goog-api-key': key },
    body: JSON.stringify({
      systemInstruction: { parts: [{ text: SYSTEM }] },
      contents: [{ role: 'user', parts: [{ text: JSON.stringify(compact(report)) }] }],
      generationConfig: { temperature: 0.2, maxOutputTokens: 220 },
    }),
    signal: AbortSignal.timeout(20_000),
  });
  if (!res.ok) throw new Error(`Gemini HTTP ${res.status}: ${(await res.text()).slice(0, 160)}`);
  const body = (await res.json()) as { candidates?: { content?: { parts?: { text?: string }[] } }[] };
  const text = (body.candidates?.[0]?.content?.parts ?? [])
    .map((p) => p.text ?? '')
    .join('')
    .replace(/\s+/g, ' ')
    .trim();
  if (!text || text.length > 600 || BANNED.test(text)) return null;
  // It must mention the real score: a cheap guard against an unrelated or invented answer.
  if (!text.includes(String(report.score))) return null;
  return text;
}
