"use client";
import { useEffect, useRef, useState } from "react";
import type { Board } from "@/lib/types";

/** "Add to deck" with a chevron menu for the maybeboard. The main button always adds to the deck. */
export function SplitAddButton({ onAdd, label = "Add to deck", size = "md", className = "" }: {
  onAdd: (board: Board) => void;
  label?: string;
  size?: "sm" | "md";
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const away = (e: MouseEvent) => { if (!box.current?.contains(e.target as Node)) setOpen(false); };
    const esc = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", away);
    document.addEventListener("keydown", esc);
    return () => { document.removeEventListener("mousedown", away); document.removeEventListener("keydown", esc); };
  }, [open]);
  const pad = size === "sm" ? "px-2 py-1 text-xs" : "px-2 py-1.5 text-xs";
  return (
    <div ref={box} className={`relative flex ${className}`}>
      <button type="button" onClick={() => { onAdd("main"); setOpen(false); }}
        className={`flex-1 rounded-l-lg bg-lime-400 font-medium text-zinc-950 hover:bg-lime-300 ${pad}`}>
        {label}
      </button>
      <button type="button" aria-label="More add options" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((v) => !v)}
        className={`rounded-r-lg border-l border-zinc-950/30 bg-lime-400 text-zinc-950 hover:bg-lime-300 ${size === "sm" ? "px-1.5" : "px-2"}`}>
        <svg width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M2 3.5l3 3 3-3" /></svg>
      </button>
      {open && (
        <ul role="menu" className="absolute right-0 top-full z-20 mt-1 min-w-40 overflow-hidden rounded-lg border border-white/10 bg-zinc-900 py-1 text-sm shadow-xl shadow-black/50">
          <li role="none">
            <button type="button" role="menuitem" onClick={() => { onAdd("maybe"); setOpen(false); }}
              className="block w-full px-3 py-1.5 text-left hover:bg-white/10">Add to maybeboard</button>
          </li>
        </ul>
      )}
    </div>
  );
}
