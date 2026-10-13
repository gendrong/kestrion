/**
 * Everything the creator page (and GET /api/v1/creator/:address) shows, built from the database only:
 * our index of every Pons launch, the stored creator profile (details from scans) and the tokens we scanned.
 */
import 'server-only';
import {
  getCreator,
  getCreatorTokens,
  launchesByDeployers,
  type Creator,
  type Db,
  type FeedItem,
  type IndexedLaunch,
  type LinkedWalletRow,
} from '@kestrion/db';

export type Outcome = 'graduated' | 'died_fast' | 'no_fast_drop' | 'unknown';

export interface CreatorLaunchView {
  token: string;
  name: string | null;
  symbol: string | null;
  factoryId: string;
  launchTime: string | null;
  logoCid: string | null;
  /** null = not scanned yet. */
  score: number | null;
  label: string | null;
  outcome: Outcome;
}

export interface CreatorView {
  address: string;
  /** False when we have neither a profile nor a scanned token for this wallet. */
  known: boolean;
  /** True when the full on-chain launch search hasn't run yet (only scanned tokens are listed). */
  historyPending: boolean;
  firstSeen: string | null;
  fundingSource: string | null;
  funder: string | null;
  funderLabel: string | null;
  stats: {
    launches: number;
    /** The search may have missed launches (e.g. through other contracts). */
    launchesPartial: boolean;
    diedFast: number;
    /** Launches whose 24h outcome is known (the base for the "died fast" share). */
    outcomeKnown: number;
    graduated: number;
    scanned: number;
    averageScore: number | null;
  };
  launches: CreatorLaunchView[];
  linkedWallets: LinkedWalletRow[];
  updatedAt: string | null;
}

function outcomeOf(graduated: boolean | null | undefined, diedFast: boolean | null | undefined): Outcome {
  if (graduated) return 'graduated';
  if (diedFast === true) return 'died_fast';
  if (diedFast === false) return 'no_fast_drop';
  return 'unknown';
}

export function buildCreatorView(address: string, creator: Creator | null, tokens: FeedItem[], indexed: IndexedLaunch[] = []): CreatorView {
  const byToken = new Map(tokens.map((t) => [t.address.toLowerCase(), t]));
  const launches: CreatorLaunchView[] = [];
  const listed = new Set<string>();

  for (const l of creator?.launches ?? []) {
    const k = l.token.toLowerCase();
    const t = byToken.get(k);
    listed.add(k);
    launches.push({
      token: k,
      name: t?.name ?? l.name ?? null,
      symbol: t?.symbol ?? l.symbol ?? null,
      factoryId: l.factoryId,
      launchTime: t?.launchTime ?? l.launchTime ?? null,
      logoCid: t?.logoCid ?? null,
      score: t?.score ?? null,
      label: t?.label ?? null,
      outcome: outcomeOf(t?.graduated || l.graduated, l.diedFast),
    });
  }
  // Launches from our index that the stored profile doesn't list (its list comes from the last scan).
  for (const l of indexed) {
    if (listed.has(l.token)) continue;
    const t = byToken.get(l.token);
    listed.add(l.token);
    launches.push({
      token: l.token,
      name: t?.name ?? null,
      symbol: t?.symbol ?? null,
      factoryId: l.factory,
      launchTime: t?.launchTime ?? l.launchTime,
      logoCid: t?.logoCid ?? null,
      score: t?.score ?? null,
      label: t?.label ?? null,
      outcome: outcomeOf(t?.graduated, null),
    });
  }
  // Scanned tokens the stored launch list doesn't have yet (e.g. launched after the last search).
  for (const t of tokens) {
    if (listed.has(t.address)) continue;
    launches.push({
      token: t.address,
      name: t.name,
      symbol: t.symbol,
      factoryId: t.factory,
      launchTime: t.launchTime,
      logoCid: t.logoCid,
      score: t.score,
      label: t.label,
      outcome: outcomeOf(t.graduated, null),
    });
  }
  launches.sort((a, b) => (b.launchTime ?? '').localeCompare(a.launchTime ?? ''));

  const scores = tokens.map((t) => t.score).filter((s): s is number => s !== null);
  const known = launches.filter((l) => l.outcome === 'died_fast' || l.outcome === 'no_fast_drop' || l.outcome === 'graduated');
  return {
    address: address.toLowerCase(),
    known: !!creator || tokens.length > 0 || indexed.length > 0,
    historyPending: indexed.length === 0 && (!creator || creator.launches.length === 0),
    firstSeen: creator?.firstSeen ?? null,
    fundingSource: creator?.fundingSource ?? null,
    funder: creator?.funder ?? null,
    funderLabel: creator?.funderLabel ?? null,
    stats: {
      launches: Math.max(creator?.totalLaunches ?? 0, launches.length),
      launchesPartial: creator?.searchPartial ?? false,
      diedFast: launches.filter((l) => l.outcome === 'died_fast').length,
      outcomeKnown: known.length,
      graduated: launches.filter((l) => l.outcome === 'graduated').length,
      scanned: scores.length,
      averageScore: scores.length ? Math.round(scores.reduce((a, b) => a + b, 0) / scores.length) : null,
    },
    launches,
    linkedWallets: creator?.linkedWallets ?? [],
    updatedAt: creator?.updatedAt ?? null,
  };
}

export async function loadCreatorView(db: Db, address: string): Promise<CreatorView> {
  const [creator, tokens, indexed] = await Promise.all([
    getCreator(db, address),
    getCreatorTokens(db, address),
    launchesByDeployers(db, [address]).catch(() => []),
  ]);
  return buildCreatorView(address, creator, tokens, indexed);
}
