/**
 * Share images (Open Graph, 1200×630 PNG) for token reports, rendered here in the job, not on the website:
 * free Workers allow ~10 ms CPU per request, far too little to draw an image. The PNG is stored in D1
 * (og_images) and the website only sends the stored bytes.
 *
 * satori lays out the card and turns text into SVG paths (fonts from @fontsource, OFL); resvg turns the SVG into a PNG.
 * Token names are untrusted: satori draws them as text (no HTML/SVG injection possible); we only shorten them.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import { Resvg } from '@resvg/resvg-js';
import satori from 'satori';

const require = createRequire(import.meta.url);
const font = (pkg: string, file: string) => fs.readFileSync(require.resolve(`${pkg}/files/${file}`));

let fonts: Parameters<typeof satori>[1]['fonts'] | null = null;
function loadFonts() {
  fonts ??= [
    { name: 'Space Grotesk', data: font('@fontsource/space-grotesk', 'space-grotesk-latin-500-normal.woff'), weight: 500, style: 'normal' },
    { name: 'Space Grotesk', data: font('@fontsource/space-grotesk', 'space-grotesk-latin-700-normal.woff'), weight: 700, style: 'normal' },
    { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-400-normal.woff'), weight: 400, style: 'normal' },
    { name: 'Inter', data: font('@fontsource/inter', 'inter-latin-600-normal.woff'), weight: 600, style: 'normal' },
  ];
  return fonts;
}

// Paper Light theme (CLAUDE.md §1).
const C = {
  paper: '#F2F1EA',
  card: '#FFFFFF',
  line: '#DEDBCF',
  ink: '#0A0A0A',
  ink2: '#3D3B35',
  muted: '#6B685E',
  neon: '#C6FF00',
  highScore: '#C42318',
  warnScore: '#9A5B00',
};
const BADGE: Record<string, { bg: string; fg: string; score: string }> = {
  'Low risk': { bg: '#C6FF00', fg: '#0A0A0A', score: C.ink },
  Caution: { bg: '#FFE3AE', fg: '#6B4300', score: C.warnScore },
  'High risk': { bg: '#FFDAD5', fg: '#A3190F', score: C.highScore },
};

type Node = { type: string; props: Record<string, unknown> };
const h = (type: string, style: Record<string, unknown>, children?: unknown, extra: Record<string, unknown> = {}): Node => ({
  type,
  props: { style, children, ...extra },
});

/** Hover Badge logo (CLAUDE.md §1) as an inline SVG. */
const logo = (size: number): Node =>
  h('svg', {}, [
    h('rect', {}, undefined, { width: 64, height: 64, rx: 16, fill: C.ink }),
    h('path', {}, undefined, { d: 'M11 36 L32 17 L53 36 L45 40 L32 28.5 L19 40 Z', fill: C.neon }),
    h('circle', {}, undefined, { cx: 32, cy: 47, r: 4.5, fill: C.neon }),
  ], { width: size, height: size, viewBox: '0 0 64 64' });

/**
 * Keep only characters our (Latin-subset) fonts can draw, collapse spaces and shorten. Satori draws text, so this
 * is about looks, not safety. Other scripts and emoji are dropped rather than shown as "missing glyph" boxes.
 */
export function clean(s: string, max: number): string {
  const t = [...s.replace(/[^ -~ -ÿ‐-‧‰-⁞€™]/gu, ' ').replace(/\s+/g, ' ').trim()];
  return t.length > max ? `${t.slice(0, max - 1).join('').trimEnd()}…` : t.join('');
}

export interface OgInput {
  name: string;
  symbol: string;
  score: number;
  label: string;
  /** e.g. "Pons V2 · ETH pair" */
  subtitle: string;
}

function tokenCard(i: OgInput): Node {
  const b = BADGE[i.label] ?? { bg: '#E7E5DC', fg: C.ink2, score: C.ink };
  const symbol = clean(i.symbol, 14);
  const name = clean(i.name, 28) || (symbol ? `$${symbol}` : 'Token report');
  return h('div', { width: 1200, height: 630, display: 'flex', flexDirection: 'column', background: C.paper, padding: 56, fontFamily: 'Inter' }, [
    h('div', { display: 'flex', alignItems: 'center', justifyContent: 'space-between' }, [
      h('div', { display: 'flex', alignItems: 'center', gap: 18 }, [
        logo(64),
        h('span', { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 40, letterSpacing: -1.5, color: C.ink }, 'Kestrion'),
      ]),
      h('span', { fontSize: 24, color: C.muted }, 'Risk report · Robinhood Chain'),
    ]),
    h('div', { display: 'flex', flex: 1, marginTop: 40, background: C.card, borderRadius: 32, padding: '44px 52px', border: `2px solid ${C.line}` }, [
      h('div', { display: 'flex', flexDirection: 'column', flex: 1, justifyContent: 'space-between' }, [
        h('div', { display: 'flex', flexDirection: 'column', gap: 10 }, [
          h('span', { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 64, letterSpacing: -2.5, color: C.ink, lineHeight: 1.05 }, name),
          h('span', { fontFamily: 'Space Grotesk', fontWeight: 500, fontSize: 36, color: C.muted }, symbol ? `$${symbol}` : ''),
          h('span', { fontSize: 26, color: C.ink2, marginTop: 8 }, clean(i.subtitle, 60)),
        ]),
        h('span', { fontSize: 24, fontWeight: 600, color: C.ink }, 'Data, not advice. DYOR.'),
      ]),
      h('div', { display: 'flex', flexDirection: 'column', alignItems: 'flex-end', justifyContent: 'center', gap: 18, width: 340 }, [
        h('span', { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 200, letterSpacing: -10, lineHeight: 0.85, color: b.score }, String(i.score)),
        h('span', { fontSize: 22, color: C.muted }, 'score out of 100'),
        h('span', { display: 'flex', background: b.bg, color: b.fg, fontWeight: 600, fontSize: 32, padding: '10px 26px', borderRadius: 999 }, i.label),
      ]),
    ]),
  ]);
}

function defaultCard(): Node {
  return h('div', { width: 1200, height: 630, display: 'flex', flexDirection: 'column', justifyContent: 'space-between', background: C.paper, padding: 64, fontFamily: 'Inter' }, [
    h('div', { display: 'flex', alignItems: 'center', gap: 20 }, [
      logo(80),
      h('span', { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 52, letterSpacing: -2, color: C.ink }, 'Kestrion'),
    ]),
    h('div', { display: 'flex', flexDirection: 'column', gap: 0 }, [
      h('span', { fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 96, letterSpacing: -4.5, lineHeight: 1, color: C.ink }, 'Hovers. Watches.'),
      h('div', { display: 'flex', fontFamily: 'Space Grotesk', fontWeight: 700, fontSize: 96, letterSpacing: -4.5, lineHeight: 1.1, color: C.ink }, [
        h('span', {}, 'Strikes before the '),
        h('span', { background: C.neon, padding: '0 12px' }, 'rug.'),
      ]),
    ]),
    h('span', { fontSize: 30, color: C.ink2 }, 'Explainable risk reports for Robinhood Chain launches · Data, not advice.'),
  ]);
}

async function render(node: Node): Promise<Buffer> {
  const svg = await satori(node as never, { width: 1200, height: 630, fonts: loadFonts() });
  return new Resvg(svg, { fitTo: { mode: 'width', value: 1200 } }).render().asPng();
}

export const renderTokenOg = (i: OgInput) => render(tokenCard(i));
export const renderDefaultOg = () => render(defaultCard());
