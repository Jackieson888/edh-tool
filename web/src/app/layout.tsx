import type { Metadata } from "next";
import { GeistSans } from "geist/font/sans";
import { GeistMono } from "geist/font/mono";
import { NavProgress } from "@/components/NavProgress";
import { SiteHeader } from "@/components/SiteHeader";
import "./globals.css";


export const metadata: Metadata = {
  title: { default: "edh-tool", template: "%s · edh-tool" },
  description: "Themed, hidden-gem card picks for your Commander deck.",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable} h-full antialiased`}>
      <body className="flex min-h-full flex-col">
        <NavProgress />
        <SiteHeader />
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
