import { describe, expect, it } from 'vitest';
import { cleanMetadata, logoCid, safeLink } from '../src/util/media';

const CID1 = 'bafkreigfb73ty3oescdfsmorc4xj6dgr3kiv4i4agtyd6m2laut7emzbvq';
const CID0 = 'QmYwAPJzv5CZsnA625s3Xf2nemtYgPpHdWEz79ojWnPbdG';

describe('logoCid (only IPFS logos are ever shown)', () => {
  it('accepts ipfs:// and gateway URLs (seen on-chain)', () => {
    expect(logoCid(`ipfs://${CID1}`)).toBe(CID1);
    expect(logoCid(`https://ipfs.io/ipfs/${CID1}`)).toBe(CID1);
    expect(logoCid(`ipfs://ipfs/${CID0}`)).toBe(CID0);
  });
  it('rejects raw IPs, plain http, other hosts and junk', () => {
    expect(logoCid('http://49.51.138.78/uploads_images/20261008/32c1.png')).toBeNull();
    expect(logoCid(`http://ipfs.io/ipfs/${CID1}`)).toBeNull();
    expect(logoCid('https://evil.example/logo.png')).toBeNull();
    expect(logoCid('javascript:alert(1)')).toBeNull();
    expect(logoCid('data:image/svg+xml;base64,PHN2Zz4=')).toBeNull();
    expect(logoCid('ipfs://not-a-cid<script>')).toBeNull();
    expect(logoCid('')).toBeNull();
  });
});

describe('safeLink', () => {
  it('keeps http(s) links and drops everything else', () => {
    expect(safeLink('https://x.com/SlippProtocol')).toBe('https://x.com/SlippProtocol');
    expect(safeLink('javascript:alert(1)')).toBeNull();
    expect(safeLink('not a url')).toBeNull();
    expect(safeLink('')).toBeNull();
  });
});

describe('cleanMetadata', () => {
  it('cleans and caps text', () => {
    const m = cleanMetadata({ logo: `ipfs://${CID1}`, description: `hi\u0007${'x'.repeat(600)}`, socials: { twitter: 'https://x.com/a', website: 'javascript:1' } });
    expect(m.logoCid).toBe(CID1);
    expect(m.description.length).toBe(500);
    expect(m.description.includes('\u0007')).toBe(false);
    expect(m.socials.twitter).toBe('https://x.com/a');
    expect(m.socials.website).toBeNull();
  });
});
