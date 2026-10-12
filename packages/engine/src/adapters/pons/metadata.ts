/** Token metadata (logo, description, socials) for Pons tokens. Always cleaned before use. */
import { ponsTokenMetaAbi } from '../../chain/abis';
import type { EngineContext } from '../../context';
import type { LaunchInfo } from '../../types';
import { cleanMetadata, type TokenMetadata } from '../../util/media';

export async function readTokenMetadata(ctx: EngineContext, launch: LaunchInfo): Promise<TokenMetadata> {
  const read = <T>(functionName: 'getTokenInfo' | 'logo' | 'description' | 'socials') =>
    ctx.rpc.readContract({ address: launch.token, abi: ponsTokenMetaAbi, functionName }).then((v) => v as T).catch(() => null);

  if (launch.version === 'v2') {
    const info = await read<readonly [string, string, string, { twitter: string; telegram: string; discord: string; website: string; farcaster: string }]>('getTokenInfo');
    if (info) return cleanMetadata({ logo: info[1], description: info[2], socials: info[3] });
  }
  const [logo, description, socials] = await Promise.all([
    read<string>('logo'),
    read<string>('description'),
    read<readonly [string, string, string, string, string]>('socials'),
  ]);
  return cleanMetadata({
    logo: logo ?? undefined,
    description: description ?? undefined,
    socials: socials
      ? { twitter: socials[0], telegram: socials[1], discord: socials[2], website: socials[3], farcaster: socials[4] }
      : undefined,
  });
}
