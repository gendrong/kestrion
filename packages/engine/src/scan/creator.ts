/** What a scan learned about the creator, in a JSON-safe shape the jobs store per creator. Pure (no network). */
import type { CreatorLaunch, CreatorSnapshot, CurveState, Result, ScanData } from '../types';
import { sameAddr } from '../util/format';

/** At most this many launches are kept per creator (serial launchers can have hundreds). */
export const MAX_CREATOR_LAUNCHES = 200;

const iso = (unix: number | undefined) => (unix !== undefined ? new Date(unix * 1000).toISOString() : null);

export function buildCreatorSnapshot(d: ScanData, curve: Result<CurveState> = d.curve): CreatorSnapshot {
  const { launch } = d;
  const profile = d.creatorWallet.ok ? d.creatorWallet.value : null;

  let launches: CreatorLaunch[] | null = null;
  if (d.priorLaunches.ok) {
    const prior = d.priorLaunches.value;
    const detail = new Map(prior.launches.map((l) => [l.token.toLowerCase(), l]));
    const refs =
      prior.all ??
      prior.launches.map((l) => ({ token: l.token, factoryId: l.factoryId, launchBlock: l.launchBlock, launchTime: l.launchTime }));
    const current: CreatorLaunch = {
      token: launch.token,
      factoryId: launch.factoryId,
      launchBlock: launch.launchBlock.toString(),
      launchTime: iso(launch.launchTime),
      name: launch.name,
      symbol: launch.symbol,
      graduated: curve.ok ? curve.value.graduated : null,
      diedFast: null,
    };
    const others: CreatorLaunch[] = refs
      .filter((r) => !sameAddr(r.token, launch.token))
      .map((r) => {
        const l = detail.get(r.token.toLowerCase());
        return {
          token: r.token,
          factoryId: r.factoryId,
          launchBlock: r.launchBlock.toString(),
          launchTime: iso(r.launchTime ?? l?.launchTime),
          ...(l ? { name: l.name, symbol: l.symbol, graduated: l.graduated, diedFast: l.diedFast } : {}),
        };
      });
    launches = [current, ...others]
      .sort((a, b) => (BigInt(a.launchBlock) > BigInt(b.launchBlock) ? -1 : BigInt(a.launchBlock) < BigInt(b.launchBlock) ? 1 : 0))
      .slice(0, MAX_CREATOR_LAUNCHES);
  }

  return {
    address: launch.creator,
    firstSeen: iso(profile?.firstSeen),
    fundingSource: profile?.funderKind ?? null,
    funder: profile?.funder ?? null,
    funderLabel: profile?.funderLabel ?? null,
    launches,
    searchPartial: d.priorLaunches.ok ? d.priorLaunches.value.partial : false,
    linkedWallets: d.linked.ok ? d.linked.value.filter((w) => !sameAddr(w.address, launch.creator)) : null,
  };
}
