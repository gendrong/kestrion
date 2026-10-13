import type { ScorePoint } from '@kestrion/db';
import { timeAgo } from '@/lib/format';

/**
 * Score over time (one series: no legend; the title names it). Server-rendered SVG: 2px ink line, 8px markers with a
 * 2px surface ring, recessive guide lines at the band edges, the latest score labelled directly, a native tooltip per
 * point (hit area larger than the mark) and a table view for screen readers and exact values.
 */
const W = 360;
const H = 150;
const PAD = { l: 28, r: 40, t: 12, b: 22 };
const BANDS = [
  { at: 70, text: 'Low risk ≥70' },
  { at: 40, text: 'Caution ≥40' },
];

export function ScoreHistory({ points }: { points: ScorePoint[] }) {
  return (
    <section className="rounded-3xl bg-card p-6" aria-labelledby="history-title">
      <h2 id="history-title" className="font-display text-lg font-bold">
        Score history
      </h2>
      {points.length < 2 ? (
        <p className="mt-2 text-sm text-ink-3">
          {points.length === 1 ? 'Scanned once so far. Changes show up here after the next scan.' : 'No scans yet.'}
        </p>
      ) : (
        <Chart points={points} />
      )}
    </section>
  );
}

function Chart({ points }: { points: ScorePoint[] }) {
  const times = points.map((p) => Date.parse(p.scannedAt));
  const t0 = Math.min(...times);
  const t1 = Math.max(...times);
  const x = (t: number) => PAD.l + ((t - t0) / Math.max(1, t1 - t0)) * (W - PAD.l - PAD.r);
  const y = (s: number) => PAD.t + (1 - s / 100) * (H - PAD.t - PAD.b);
  const xy = points.map((p, i) => ({ p, cx: x(times[i]!), cy: y(p.score) }));
  // Step line: a score holds until the next scan.
  const d = xy.map((q, i) => (i === 0 ? `M${q.cx},${q.cy}` : `H${q.cx}V${q.cy}`)).join('');
  const last = xy[xy.length - 1]!;
  const first = points[0]!;
  const changes = points.filter((p, i) => i > 0 && p.score !== points[i - 1]!.score).length;

  return (
    <>
      <p className="text-sm text-muted">
        {points.length} scans since {timeAgo(first.scannedAt)} · {changes === 0 ? 'no change' : `${changes} change${changes === 1 ? '' : 's'}`}
      </p>
      <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={`Score history: ${points.map((p) => p.score).join(', ')}`}>
        {/* Recessive guides: 0/100 frame and the two band edges. */}
        {[0, 100].map((s) => (
          <line key={s} x1={PAD.l} x2={W - PAD.r} y1={y(s)} y2={y(s)} stroke="#EFEDE4" strokeWidth="1" />
        ))}
        {BANDS.map((b) => (
          <g key={b.at}>
            <line x1={PAD.l} x2={W - PAD.r} y1={y(b.at)} y2={y(b.at)} stroke="#DEDBCF" strokeWidth="1" strokeDasharray="3 3" />
            <text x={PAD.l - 4} y={y(b.at) + 3} textAnchor="end" fontSize="9" fill="#6B685E">
              {b.at}
            </text>
          </g>
        ))}
        <text x={PAD.l - 4} y={y(100) + 3} textAnchor="end" fontSize="9" fill="#6B685E">
          100
        </text>
        <text x={PAD.l - 4} y={y(0) + 3} textAnchor="end" fontSize="9" fill="#6B685E">
          0
        </text>
        <path d={d} fill="none" stroke="#0A0A0A" strokeWidth="2" strokeLinejoin="round" />
        {xy.map((q) => (
          <g key={q.p.scannedAt}>
            <title>{`${q.p.score}/100 ${q.p.label} · ${new Date(q.p.scannedAt).toUTCString().slice(5, 22)} UTC · engine ${q.p.engineVersion}`}</title>
            <circle cx={q.cx} cy={q.cy} r="12" fill="transparent" />
            <circle cx={q.cx} cy={q.cy} r="4" fill="#0A0A0A" stroke="#FFFFFF" strokeWidth="2" />
          </g>
        ))}
        {/* Direct label: the latest score only. */}
        <text x={last.cx + 8} y={last.cy + 4} fontSize="12" fontWeight="700" fill="#0A0A0A">
          {last.p.score}
        </text>
        <text x={PAD.l} y={H - 6} fontSize="9" fill="#6B685E">
          {timeAgo(first.scannedAt)}
        </text>
        <text x={W - PAD.r} y={H - 6} fontSize="9" fill="#6B685E" textAnchor="end">
          {timeAgo(last.p.scannedAt)}
        </text>
      </svg>
      <details className="mt-2 text-sm">
        <summary className="inline-flex min-h-9 cursor-pointer items-center font-medium text-ink-3 hover:text-ink">Show as table</summary>
        <table className="mt-1 w-full text-left text-[13px]">
          <caption className="sr-only">Every scan of this token</caption>
          <thead>
            <tr className="text-muted">
              <th scope="col" className="py-1 font-semibold">
                Scanned
              </th>
              <th scope="col" className="py-1 font-semibold">
                Score
              </th>
              <th scope="col" className="py-1 font-semibold">
                Label
              </th>
            </tr>
          </thead>
          <tbody>
            {[...points].reverse().map((p) => (
              <tr key={p.scannedAt} className="border-t border-line-soft">
                <td className="py-1">
                  <time dateTime={p.scannedAt}>{timeAgo(p.scannedAt)}</time>
                </td>
                <td className="py-1 font-display font-semibold tabular-nums">{p.score}</td>
                <td className="py-1">{p.label}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </details>
    </>
  );
}
