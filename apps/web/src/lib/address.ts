/** Address validation without loading the scanning engine (keeps the Worker bundle small). */
const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Lower-cased address, or null when the input is not a 0x address. Validate every input with this. */
export function normalizeAddress(input: string | null | undefined): string | null {
  if (!input) return null;
  let s = input.trim();
  try {
    s = decodeURIComponent(s);
  } catch {
    return null;
  }
  return ADDRESS_RE.test(s) ? s.toLowerCase() : null;
}
