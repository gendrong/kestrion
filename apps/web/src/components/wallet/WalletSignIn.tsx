'use client';

/**
 * Wallet sign-in (RainbowKit + wagmi + Sign-In with Ethereum). Loaded only when someone taps "Sign in", so the
 * wallet libraries never slow down the first page load. Read-only: the wallet signs a plain-text message proving
 * ownership; nothing is ever sent on-chain and no transaction is ever requested.
 */
import '@rainbow-me/rainbowkit/styles.css';
import {
  connectorsForWallets,
  createAuthenticationAdapter,
  lightTheme,
  RainbowKitAuthenticationProvider,
  RainbowKitProvider,
  useConnectModal,
  type AuthenticationStatus,
} from '@rainbow-me/rainbowkit';
import { coinbaseWallet, injectedWallet, metaMaskWallet, rabbyWallet, trustWallet, walletConnectWallet } from '@rainbow-me/rainbowkit/wallets';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { useEffect, useMemo, useRef, useState } from 'react';
import { createSiweMessage } from 'viem/siwe';
import { createConfig, http, WagmiProvider } from 'wagmi';
import { arbitrum, base, mainnet } from 'wagmi/chains';
import { robinhoodChain } from '@/lib/chains';
import { WALLETCONNECT_PROJECT_ID } from '@/lib/site';

const STATEMENT = 'Sign in to Kestrion. This only proves you own this wallet: it is free and sends no transaction.';

function makeWagmiConfig() {
  const projectId = WALLETCONNECT_PROJECT_ID;
  // Without a WalletConnect project ID only wallets that inject into the page (browser extensions, wallet apps'
  // built-in browsers) can connect.
  const wallets = projectId ? [injectedWallet, metaMaskWallet, rabbyWallet, coinbaseWallet, trustWallet, walletConnectWallet] : [injectedWallet, coinbaseWallet];
  const connectors = connectorsForWallets([{ groupName: 'Wallets', wallets }], {
    appName: 'Kestrion',
    projectId: projectId || 'not-configured',
  });
  // Sign-in works on any of these chains (the signature is the same); Robinhood Chain is listed first.
  return createConfig({
    chains: [robinhoodChain, mainnet, arbitrum, base],
    connectors,
    transports: { [robinhoodChain.id]: http(), [mainnet.id]: http(), [arbitrum.id]: http(), [base.id]: http() },
    ssr: true,
  });
}

/** Opens the connect modal as soon as it is ready; tells the parent when the user closes it without signing in. */
function OpenOnMount({ onClose }: { onClose: () => void }) {
  const { openConnectModal, connectModalOpen } = useConnectModal();
  const opened = useRef(false);
  useEffect(() => {
    if (!opened.current && openConnectModal) {
      opened.current = true;
      openConnectModal();
    }
  }, [openConnectModal]);
  useEffect(() => {
    if (opened.current && !connectModalOpen) {
      // Closed: wait a moment, the sign-message step may be opening right after the wallet connected.
      const t = setTimeout(onClose, 1500);
      return () => clearTimeout(t);
    }
  }, [connectModalOpen, onClose]);
  return null;
}

export default function WalletSignIn({ onClose, onSignedIn }: { onClose: () => void; onSignedIn: () => void }) {
  const [status, setStatus] = useState<AuthenticationStatus>('unauthenticated');
  const [error, setError] = useState<string | null>(null);
  const config = useMemo(makeWagmiConfig, []);
  const queryClient = useMemo(() => new QueryClient(), []);

  const adapter = useMemo(
    () =>
      createAuthenticationAdapter({
        getNonce: async () => {
          const res = await fetch('/api/auth/nonce', { cache: 'no-store' });
          const body = (await res.json()) as { nonce?: string; error?: string };
          if (!body.nonce) throw new Error(body.error ?? 'Could not start sign-in');
          return body.nonce;
        },
        createMessage: ({ nonce, address, chainId }) =>
          createSiweMessage({
            domain: window.location.host,
            address,
            statement: STATEMENT,
            uri: window.location.origin,
            version: '1',
            chainId,
            nonce,
            issuedAt: new Date(),
          }),
        verify: async ({ message, signature }) => {
          setStatus('loading');
          const res = await fetch('/api/auth/verify', {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify({ message, signature }),
          });
          if (!res.ok) {
            const body = (await res.json().catch(() => ({}))) as { error?: string };
            setError(body.error ?? 'Sign-in failed');
            setStatus('unauthenticated');
            return false;
          }
          setStatus('authenticated');
          onSignedIn();
          return true;
        },
        signOut: async () => {
          await fetch('/api/auth/logout', { method: 'POST' });
          setStatus('unauthenticated');
        },
      }),
    [onSignedIn],
  );

  return (
    <WagmiProvider config={config}>
      <QueryClientProvider client={queryClient}>
        <RainbowKitAuthenticationProvider adapter={adapter} status={status}>
          <RainbowKitProvider
            initialChain={robinhoodChain}
            modalSize="compact"
            theme={lightTheme({ accentColor: '#0A0A0A', accentColorForeground: '#C6FF00', borderRadius: 'medium', fontStack: 'system' })}
            appInfo={{ appName: 'Kestrion', disclaimer: () => <span>Read-only: Kestrion never asks for a transaction or your funds.</span> }}
          >
            <OpenOnMount onClose={onClose} />
            {error && (
              <p role="alert" className="fixed inset-x-4 bottom-4 z-50 rounded-xl bg-high-bg p-3 text-sm font-medium text-high-fg sm:left-auto sm:w-96">
                {error}
              </p>
            )}
          </RainbowKitProvider>
        </RainbowKitAuthenticationProvider>
      </QueryClientProvider>
    </WagmiProvider>
  );
}
