/** Plain-text rendering of a report for the terminal. */
import type { CheckStatus, ScanReport } from '../types';
import { fmtAmount, fmtDuration, shortAddr } from '../util/format';

// Decided at call time so importing this module never touches process.stdout (safe for the web app).
const useColor = () => typeof process !== 'undefined' && !!process.stdout?.isTTY && !process.env.NO_COLOR;
const paint = (code: string) => (s: string) => (useColor() ? `\x1b[${code}m${s}\x1b[0m` : s);
const c = { bold: paint('1'), dim: paint('2'), red: paint('31'), green: paint('32'), yellow: paint('33'), gray: paint('90') };

const STATUS: Record<CheckStatus, string> = {
  pass: c.green(' PASS '),
  warn: c.yellow(' WARN '),
  fail: c.red(' FAIL '),
  unknown: c.gray(' ???? '),
};

const json = (v: unknown) => JSON.stringify(v, (_k, x) => (typeof x === 'bigint' ? x.toString() : x));

export function renderReport(r: ScanReport): string {
  const lines: string[] = [];
  const push = (s = '') => lines.push(s);
  const labelColor = r.label === 'Low risk' ? c.green : r.label === 'Caution' ? c.yellow : c.red;
  const factory = { 'pons-v2': 'Pons V2', 'pons-v1-active': 'Pons V1 (active factory)', 'pons-v1-legacy': 'Pons V1 (legacy factory)' }[
    r.launchpad.factoryId
  ];
  const ageSec = (Date.parse(r.scannedAt) - Date.parse(r.launch.time)) / 1000;

  push(c.bold(`KESTRION RISK REPORT`) + c.dim(`  · engine ${r.engineVersion} · ${r.scannedAt}`));
  push('─'.repeat(72));
  push(`Token      ${c.bold(`${r.token.name} (${r.token.symbol})`)}  ${r.token.address}`);
  push(`Launchpad  ${factory}  ${c.dim(r.launchpad.factory)}`);
  push(
    `Creator    ${r.creator.address}` +
      (r.creator.deployerIsContract ? c.dim(`  (launched via contract ${shortAddr(r.creator.deployer)})`) : ''),
  );
  push(`Launched   ${r.launch.time.replace('T', ' ').slice(0, 19)} UTC (${fmtDuration(ageSec)} ago) · block ${r.launch.block}`);
  push(`Pair       ${r.pair.type === 'Other' ? `${r.pair.symbol} (other token)` : r.pair.symbol}`);
  if (r.curve) {
    push(`Curve      ${r.curve.graduated ? 'graduated' : `${r.curve.progressPct}% to graduation`} · phase ${r.curve.phase}`);
  }
  push();
  push(c.bold(`SCORE ${r.score}/100  `) + labelColor(c.bold(r.label.toUpperCase())));
  push(r.summary);
  push();
  for (const ch of r.checks) {
    const ded = ch.deduction > 0 ? c.red(`−${ch.deduction}`) : c.dim('  0');
    push(`${STATUS[ch.status]} ${c.bold(ch.title.padEnd(26))} ${ded}`);
    push(`       ${ch.explanation}`);
    push(c.dim(`       raw: ${json(ch.value)}`));
  }
  if (r.topHolders.length) {
    push();
    push(c.bold('Top holders') + c.dim(' (pool, curve, lockers and burn excluded)'));
    for (const h of r.topHolders) push(`  ${h.pct.toFixed(2).padStart(6)}%  ${h.address}${h.label ? c.dim(`  ${h.label}`) : ''}`);
  }
  if (r.notes.length) {
    push();
    push(c.bold('Data notes'));
    for (const n of r.notes) push(c.dim(`  · ${n}`));
  }
  push();
  push(c.dim(`Supply ${fmtAmount(BigInt(r.token.totalSupply), r.token.decimals, 0)} · launch tx ${r.launch.tx}`));
  push(c.bold(r.disclaimer));
  return lines.join('\n');
}
