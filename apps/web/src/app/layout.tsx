import type { Metadata, Viewport } from 'next';
import localFont from 'next/font/local';
import Link from 'next/link';
import { Logo, LogoMark } from '@/components/Logo';
import { DEFAULT_OG_IMAGE, SITE_NAME, SITE_URL } from '@/lib/site';
import './globals.css';

// Self-hosted variable fonts (OFL, from Fontsource; licenses in ./fonts). No network needed at build or run time.
const inter = localFont({ src: './fonts/inter-latin-wght.woff2', weight: '100 900', variable: '--font-inter', display: 'swap' });
const spaceGrotesk = localFont({
  src: './fonts/space-grotesk-latin-wght.woff2',
  weight: '300 700',
  variable: '--font-space-grotesk',
  display: 'swap',
});

const DESCRIPTION =
  'Explainable risk reports for every token launched on Robinhood Chain launchpads. Rule-based checks, raw numbers, no hype. Data, not advice.';

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: { default: 'Kestrion: risk reports for Robinhood Chain launches', template: '%s · Kestrion' },
  description: DESCRIPTION,
  applicationName: SITE_NAME,
  // Pages without their own image (home, creator, today, about) share the default card.
  openGraph: {
    type: 'website',
    siteName: SITE_NAME,
    description: DESCRIPTION,
    images: [{ url: DEFAULT_OG_IMAGE, width: 1200, height: 630, alt: 'Kestrion: Hovers. Watches. Strikes before the rug.' }],
  },
  twitter: { card: 'summary_large_image', images: [DEFAULT_OG_IMAGE] },
};

export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  themeColor: '#F2F1EA',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" className={`${inter.variable} ${spaceGrotesk.variable}`}>
      <body className="flex min-h-dvh flex-col">
        <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-4 focus:top-4 focus:z-50 focus:rounded-lg focus:bg-card focus:px-4 focus:py-2">
          Skip to content
        </a>
        <header className="border-b border-line">
          <div className="mx-auto flex max-w-[1240px] items-center justify-between gap-4 px-4 py-3 sm:px-6">
            <Link href="/" aria-label="Kestrion home" className="flex min-h-11 items-center">
              <Logo />
            </Link>
            <nav aria-label="Main" className="flex items-center gap-1 text-[15px] font-medium">
              <Link href="/#feed" className="rounded-lg px-2.5 py-2.5 text-ink hover:text-ink-2 sm:px-3">
                Live
              </Link>
              <Link href="/today" className="rounded-lg px-2.5 py-2.5 text-ink hover:text-ink-2 sm:px-3">
                Today
              </Link>
              <Link href="/about" className="rounded-lg px-2.5 py-2.5 text-ink-3 hover:text-ink sm:px-3">
                About
              </Link>
            </nav>
          </div>
        </header>

        <main id="main" className="flex-1">
          {children}
        </main>

        <footer className="border-t border-line">
          <div className="mx-auto flex max-w-[1240px] flex-col gap-3 px-4 py-10 sm:px-6">
            <div className="flex items-center gap-2.5">
              <LogoMark size={28} />
              <span className="font-display text-lg font-bold tracking-[-0.03em]">Kestrion</span>
            </div>
            <p className="text-sm font-semibold">Data, not advice. DYOR.</p>
            <p className="text-sm text-ink-2">Read-only: Kestrion never holds keys or sends transactions.</p>
            <p className="text-[13px] text-muted">Kestrion is independent and not affiliated with Robinhood Markets or Pons Labs.</p>
          </div>
        </footer>
      </body>
    </html>
  );
}
