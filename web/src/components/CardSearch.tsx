"use client";
import { useEffect, useId, useRef, useState } from "react";
import { ColorIndicator, ManaCost } from "@/components/Mana";
import type { CardLite } from "@/lib/types";

/** Type-ahead over every Commander-legal card. Arrow keys + Enter pick a result. */
export function CardSearch({ onPick, placeholder = "Search cards…", filter, className = "", autoFocus = false, clearOnPick = true }: {
  onPick: (card: CardLite) => void;
  placeholder?: string;
  filter?: (card: CardLite) => boolean;
  className?: string;
  autoFocus?: boolean;
  clearOnPick?: boolean;
}) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<CardLite[]>([]);
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const shown = q.trim().length < 2 ? [] : results;
  const listId = useId();
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (q.trim().length < 2) return;
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/cards/search?q=${encodeURIComponent(q)}&limit=${filter ? 30 : 12}`, { signal: ctl.signal });
        const { cards } = (await r.json()) as { cards: CardLite[] };
        setResults((filter ? cards.filter(filter) : cards).slice(0, 12));
        setActive(0);
        setOpen(true);
      } catch {
        // aborted by the next keystroke
      }
    }, 150);
    return () => { clearTimeout(t); ctl.abort(); };
  }, [q, filter]);

  useEffect(() => {
    const close = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    document.addEventListener("mousedown", close);
    return () => document.removeEventListener("mousedown", close);
  }, []);

  const pick = (c: CardLite) => {
    onPick(c);
    setOpen(false);
    if (clearOnPick) { setQ(""); setResults([]); } else setQ(c.name);
  };

  return (
    <div ref={box} className={`relative ${className}`}>
      <input
        type="search" value={q} placeholder={placeholder} autoFocus={autoFocus}
        role="combobox" aria-expanded={open} aria-controls={listId} aria-autocomplete="list"
        onChange={(e) => setQ(e.target.value)}
        onFocus={() => shown.length && setOpen(true)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown") { e.preventDefault(); setActive((a) => Math.min(a + 1, shown.length - 1)); }
          else if (e.key === "ArrowUp") { e.preventDefault(); setActive((a) => Math.max(a - 1, 0)); }
          else if (e.key === "Enter" && shown[active]) { e.preventDefault(); pick(shown[active]); }
          else if (e.key === "Escape") setOpen(false);
        }}
        className="w-full rounded-lg border border-white/10 bg-white/5 px-3 py-2 text-sm placeholder:text-zinc-500 focus:border-lime-400/60 focus:outline-none"
      />
      {open && q.trim().length >= 2 && (
        <ul id={listId} role="listbox"
          className="absolute z-30 mt-1 max-h-80 w-full min-w-72 overflow-auto rounded-lg border border-white/10 bg-zinc-900 py-1 shadow-xl shadow-black/50">
          {shown.length === 0 && <li className="px-3 py-2 text-sm text-zinc-500">No matching cards</li>}
          {shown.map((c, i) => (
            <li key={c.oracle_id} role="option" aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => { e.preventDefault(); pick(c); }}
              className={`flex cursor-pointer items-center justify-between gap-3 px-3 py-1.5 text-sm ${i === active ? "bg-white/10" : ""}`}>
              <span className="flex min-w-0 items-center gap-2">
                <ColorIndicator colors={c.color_identity} className="shrink-0 text-xs" />
                <span className="truncate">{c.name}</span>
              </span>
              <ManaCost cost={c.mana_cost} className="shrink-0 text-xs" />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
