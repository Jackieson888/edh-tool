import type { Metadata } from "next";
import Link from "next/link";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { HeaderSearch } from "@/components/HeaderSearch";
import "./globals.css";


export const metadata: Metadata = {
  title: { default: "edh-tool", template: "%s · edh-tool" },
  description: "Themed, hidden-gem card picks for your Commander deck.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <header className="border-b border-white/10">
          <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-x-6 gap-y-2 px-4 py-3">
            <div className="flex items-center gap-6">
              <Link href="/" className="font-mono text-lg font-semibold tracking-tight">
                edh<span className="text-lime-400">-</span>tool
              </Link>
              <nav className="flex gap-4 text-sm text-zinc-400">
                <Link href="/" className="hover:text-zinc-100">Commanders</Link>
                <Link href="/decks" className="hover:text-zinc-100">My decks</Link>
              </nav>
            </div>
            <HeaderSearch />
          </div>
        </header>
        <main className="mx-auto w-full max-w-6xl flex-1 px-4 py-8">{children}</main>
        <footer className="border-t border-white/10 text-xs text-zinc-500">
          <div className="mx-auto max-w-6xl space-y-1 px-4 py-6">
            <p>
              Card data and images from <a className="underline" href="https://scryfall.com">Scryfall</a>; art
              and oracle tags from the Scryfall Tagger community.
            </p>
            <p>
              edh-tool is unofficial Fan Content permitted under the Fan Content Policy. Not approved/endorsed by
              Wizards. Portions of the materials used are property of Wizards of the Coast. ©Wizards of the Coast LLC.
            </p>
          </div>
        </footer>
      </body>
    </html>
  );
}
