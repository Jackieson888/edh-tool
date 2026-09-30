"use client";
import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { CardImage } from "@/components/CardImage";
import { ColorIndicator, ManaCost } from "@/components/Mana";
import { TagChip } from "@/components/TagChip";
import type { CardLite } from "@/lib/types";

interface Detail { oracle_text: string; power?: string | null; toughness?: string | null;
  tags: { tag: string; role: string; strength: number; definition?: string }[] }
const cache = new Map<string, Detail>();

/** Modal card preview: the image, oracle text and the AI tags that drive theme matching. */
export function CardPreview({ card, theme, moveLabel, onMove, onClose }: {
  card: CardLite;
  theme?: string;                 // best-fit theme for this deck, when known
  moveLabel?: string;             // e.g. "Move to maybeboard"
  onMove?: () => void;
  onClose: () => void;
}) {
  const [fetched, setFetched] = useState<{ id: string; d: Detail | null } | null>(null);
  const closeBtn = useRef<HTMLButtonElement>(null);
  const detail = cache.get(card.oracle_id) ?? (fetched?.id === card.oracle_id ? fetched.d : null);
  const failed = fetched?.id === card.oracle_id && !fetched.d && !cache.has(card.oracle_id);

  useEffect(() => {
    if (cache.has(card.oracle_id)) return;
    const ctl = new AbortController();
    fetch(`/api/cards/tags?id=${card.oracle_id}`, { signal: ctl.signal })
      .then((r) => (r.ok ? r.json() : null))
      .then((d: Detail | null) => { if (d) cache.set(card.oracle_id, d); setFetched({ id: card.oracle_id, d }); })
      .catch(() => { if (!ctl.signal.aborted) setFetched({ id: card.oracle_id, d: null }); });
    return () => ctl.abort();
  }, [card.oracle_id]);

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null;
    closeBtn.current?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      if (e.key === "Tab") {                       // keep focus inside the dialog
        const els = document.querySelectorAll<HTMLElement>("[data-preview] a, [data-preview] button");
        if (!els.length) return;
        const first = els[0], last = els[els.length - 1];
        if (e.shiftKey && document.activeElement === first) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      }
    };
    document.addEventListener("keydown", key);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => { document.removeEventListener("keydown", key); document.body.style.overflow = prev; opener?.focus?.(); };
  }, [onClose]);

  const strong = detail?.tags.filter((t) => t.strength >= 0.6) ?? [];
  const rest = detail?.tags.filter((t) => t.strength < 0.6) ?? [];

  return (
    <div className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-black/70 p-4 sm:items-center"
      onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div role="dialog" aria-modal="true" aria-label={card.name} data-preview
        className="relative my-4 grid w-full max-w-3xl gap-6 rounded-2xl border border-white/10 bg-zinc-900 p-5 shadow-2xl shadow-black/60 sm:grid-cols-[minmax(0,280px)_1fr]">
        <button ref={closeBtn} type="button" onClick={onClose} aria-label="Close"
          className="absolute right-3 top-3 grid h-8 w-8 place-items-center rounded-lg text-zinc-400 hover:bg-white/10 hover:text-zinc-100">✕</button>
        <div className="mx-auto w-full max-w-[280px]"><CardImage src={card.image} alt={card.name} /></div>
        <div className="min-w-0 space-y-4 pr-6">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
              <h2 className="text-xl font-semibold">{card.name}</h2>
              <ManaCost cost={card.mana_cost} />
            </div>
            <p className="flex flex-wrap items-center gap-x-3 text-sm text-zinc-400">
              <span>{card.type_line}</span>
              <ColorIndicator colors={card.color_identity} className="text-sm" />
            </p>
          </div>
          {detail?.oracle_text && <p className="whitespace-pre-line text-sm text-zinc-300">{detail.oracle_text}</p>}
          {theme && <p className="text-sm text-zinc-400">Fits your deck&apos;s <span className="text-lime-300">{theme}</span> theme</p>}
          <div className="space-y-2">
            <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-500">Tags</h3>
            {!detail && !failed && <p className="text-sm text-zinc-500">Loading…</p>}
            {failed && <p className="text-sm text-zinc-500">Couldn&apos;t load tags.</p>}
            {detail && !detail.tags.length && <p className="text-sm text-zinc-500">Not tagged yet, so it doesn&apos;t count toward themes.</p>}
            {strong.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {strong.map((t) => <TagChip key={t.tag} tag={t.tag} strong detail={t.role !== "any" ? t.role : undefined} title={t.definition} />)}
              </div>
            )}
            {rest.length > 0 && (
              <div className="flex flex-wrap gap-1.5">
                {rest.map((t) => <TagChip key={t.tag} tag={t.tag} detail={t.role !== "any" ? t.role : undefined} title={t.definition} />)}
              </div>
            )}
          </div>
          <div className="flex flex-wrap gap-2 pt-1">
            <Link href={`/card/${card.oracle_id}`}
              className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:border-white/30">Open card page</Link>
            {onMove && (
              <button type="button" onClick={() => { onMove(); onClose(); }}
                className="rounded-lg border border-white/15 px-3 py-1.5 text-sm hover:border-white/30">{moveLabel ?? "Move"}</button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
