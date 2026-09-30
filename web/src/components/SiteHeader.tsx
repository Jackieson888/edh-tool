"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { HeaderSearch } from "@/components/HeaderSearch";

const NAV = [
  { href: "/commanders", label: "Browse Commanders" },
  { href: "/decks", label: "My Decks" },
];

/** One line at every width: logo, search, nav. Below md the nav folds into a menu button. */
export function SiteHeader() {
  const path = usePathname();
  const [open, setOpen] = useState(false);
  useEffect(() => setOpen(false), [path]);
  useEffect(() => {
    if (!open) return;
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("keydown", esc);
    return () => document.removeEventListener("keydown", esc);
  }, [open]);
  const active = (href: string) => path === href || path.startsWith(href + "/");

  return (
    <header className="relative border-b border-white/10">
      <div className="mx-auto flex max-w-6xl flex-nowrap items-center gap-3 px-4 py-3 md:gap-6">
        <Link
          href="/"
          className="shrink-0 font-mono text-lg font-semibold tracking-tight"
        >
          edh<span className="text-lime-400">-</span>tool
        </Link>
        <nav
          className="hidden gap-4 text-sm text-zinc-400 md:flex"
          aria-label="Main"
        >
          {NAV.map((n) => (
            <Link
              key={n.href}
              href={n.href}
              aria-current={active(n.href) ? "page" : undefined}
              className={
                active(n.href) ? "text-zinc-100" : "hover:text-zinc-100"
              }
            >
              {n.label}
            </Link>
          ))}
        </nav>
        <HeaderSearch className="min-w-0 flex-1 md:ml-auto md:max-w-sm" />
        <button
          type="button"
          aria-label="Menu"
          aria-expanded={open}
          onClick={() => setOpen((v) => !v)}
          className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-white/10 text-zinc-300 hover:border-white/30 md:hidden"
        >
          <svg
            width="18"
            height="18"
            viewBox="0 0 18 18"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            strokeLinecap="round"
            aria-hidden="true"
          >
            {open ? (
              <path d="M4 4l10 10M14 4L4 14" />
            ) : (
              <path d="M3 5h12M3 9h12M3 13h12" />
            )}
          </svg>
        </button>
      </div>
      {open && (
        <nav
          aria-label="Menu"
          className="absolute inset-x-0 top-full z-40 border-b border-white/10 bg-zinc-950 md:hidden"
        >
          <ul className="mx-auto max-w-6xl px-4 py-2">
            {NAV.map((n) => (
              <li key={n.href}>
                <Link
                  href={n.href}
                  aria-current={active(n.href) ? "page" : undefined}
                  className={`block py-2.5 text-sm ${active(n.href) ? "text-lime-300" : "text-zinc-300"}`}
                >
                  {n.label}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
      )}
    </header>
  );
}
