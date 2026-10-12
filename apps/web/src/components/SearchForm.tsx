'use client';

import { useRouter } from 'next/navigation';
import { useId, useState, type FormEvent } from 'react';

const ADDRESS_RE = /^0x[0-9a-fA-F]{40}$/;

/** Search box: validates the address and routes to its report. */
export function SearchForm({ size = 'large', autoFocus = false }: { size?: 'large' | 'compact'; autoFocus?: boolean }) {
  const router = useRouter();
  const id = useId();
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const large = size === 'large';

  function onSubmit(e: FormEvent) {
    e.preventDefault();
    const address = value.trim();
    if (!ADDRESS_RE.test(address)) {
      setError('Enter a valid address: 0x followed by 40 letters/numbers.');
      return;
    }
    setError(null);
    router.push(`/t/${address}`);
  }

  return (
    <form role="search" action="/scan" method="get" onSubmit={onSubmit} className="flex w-full flex-col gap-2" noValidate>
      <label htmlFor={id} className={large ? 'text-sm font-semibold' : 'sr-only'}>
        Token address
      </label>
      <div className="flex flex-wrap gap-2.5">
        <div
          className={`flex min-w-0 flex-[1_1_260px] items-center gap-2.5 rounded-[14px] border-[1.5px] bg-card px-4 ${
            error ? 'border-high' : 'border-ink'
          } ${large ? 'h-[60px]' : 'h-12'}`}
        >
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="#6B685E" strokeWidth="1.8" strokeLinecap="round" aria-hidden="true">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" />
          </svg>
          <input
            id={id}
            name="address"
            type="text"
            inputMode="text"
            autoComplete="off"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            autoFocus={autoFocus}
            placeholder="Paste a 0x… token address"
            value={value}
            onChange={(e) => {
              setValue(e.target.value);
              if (error) setError(null);
            }}
            aria-invalid={!!error}
            aria-describedby={error ? `${id}-error` : undefined}
            className={`h-full min-w-0 flex-1 bg-transparent text-ink outline-none placeholder:text-muted ${large ? 'text-[17px]' : 'text-base'}`}
          />
        </div>
        <button
          type="submit"
          className={`cursor-pointer rounded-[14px] bg-ink font-display font-bold text-neon transition hover:bg-ink-2 ${
            large ? 'h-[60px] px-7 text-lg' : 'h-12 px-5 text-base'
          }`}
        >
          Scan →
        </button>
      </div>
      {error && (
        <p id={`${id}-error`} role="alert" className="text-sm font-medium text-high-fg">
          {error}
        </p>
      )}
    </form>
  );
}
