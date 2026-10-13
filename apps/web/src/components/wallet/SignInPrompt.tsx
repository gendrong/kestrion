'use client';

import { requestSignIn } from './AccountMenu';

/** Shown on pages that need a signed-in wallet. */
export function SignInPrompt({ title, text }: { title: string; text: string }) {
  return (
    <div className="mx-auto max-w-[760px] px-4 py-10 sm:px-6">
      <section className="flex flex-col gap-3 rounded-3xl bg-card p-6 sm:p-8">
        <h1 className="font-display text-3xl font-bold tracking-[-0.03em]">{title}</h1>
        <p className="text-ink-2">{text}</p>
        <p className="text-sm text-muted">Signing in only proves you own the wallet: it is free and never sends a transaction.</p>
        <button
          type="button"
          onClick={requestSignIn}
          className="mt-2 min-h-11 cursor-pointer self-start rounded-xl bg-ink px-5 font-display font-bold text-neon hover:bg-ink-2"
        >
          Sign in with your wallet
        </button>
      </section>
    </div>
  );
}
