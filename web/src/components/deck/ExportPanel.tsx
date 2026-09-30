"use client";
import { useMemo, useState } from "react";
import { exportDecklist } from "@edh-tool/engine/decklist";
import type { CardLite, Deck } from "@/lib/types";

const FORMATS = [
  { id: "text", label: "Plain text" },
  { id: "moxfield", label: "Moxfield" },
  { id: "archidekt", label: "Archidekt" },
] as const;

export function ExportPanel({ deck, cards, categories }: {
  deck: Deck;
  cards: Map<string, CardLite>;
  categories?: Record<string, string>;
}) {
  const [format, setFormat] = useState<(typeof FORMATS)[number]["id"]>("moxfield");
  const [printings, setPrintings] = useState(true);
  const [maybe, setMaybe] = useState(true);
  const [byTheme, setByTheme] = useState(false);
  const [copied, setCopied] = useState(false);
  const hasPrintings = deck.cards.some((c) => c.printing);
  const missing = [...deck.commanders, ...deck.cards.map((c) => c.oracle_id)].some((id) => !cards.has(id));

  const text = useMemo(() => {
    const names = new Map([...cards].map(([id, c]) => [id, c.name]));
    return exportDecklist(deck, names, {
      format, printings: printings && hasPrintings, maybeboard: maybe,
      categories: format === "archidekt" && byTheme ? categories : undefined,
    });
  }, [deck, cards, format, printings, hasPrintings, maybe, byTheme, categories]);

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      // clipboard blocked: the text area below is still selectable
    }
  };
  const download = () => {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(new Blob([text], { type: "text/plain" }));
    a.download = `${deck.name.replace(/[^\w-]+/g, "_") || "deck"}.txt`;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  return (
    <section className="space-y-3">
      <h2 className="text-lg font-semibold">Export</h2>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2 text-sm">
        <div role="radiogroup" aria-label="Format" className="flex overflow-hidden rounded-lg border border-white/15">
          {FORMATS.map((f) => (
            <button key={f.id} type="button" role="radio" aria-checked={format === f.id} onClick={() => setFormat(f.id)}
              className={`px-3 py-1.5 ${format === f.id ? "bg-lime-400/15 text-lime-300" : "text-zinc-400 hover:text-zinc-200"}`}>
              {f.label}
            </button>
          ))}
        </div>
        <label className="flex items-center gap-1.5 text-zinc-300">
          <input type="checkbox" checked={maybe} onChange={(e) => setMaybe(e.target.checked)} /> Include maybeboard
        </label>
        {hasPrintings && (
          <label className="flex items-center gap-1.5 text-zinc-300">
            <input type="checkbox" checked={printings} onChange={(e) => setPrintings(e.target.checked)} /> Keep imported printings
          </label>
        )}
        {format === "archidekt" && (
          <label className="flex items-center gap-1.5 text-zinc-300" title="Uses each card's best-fit theme as its Archidekt category">
            <input type="checkbox" checked={byTheme} onChange={(e) => setByTheme(e.target.checked)} disabled={!categories} /> Categories from themes
          </label>
        )}
      </div>
      {missing && <p className="text-xs text-amber-300">Some card names are still loading; wait a moment before exporting.</p>}
      <textarea readOnly value={text} rows={8} onFocus={(e) => e.currentTarget.select()} aria-label="Exported decklist"
        className="w-full rounded-lg border border-white/10 bg-zinc-900 p-3 font-mono text-xs text-zinc-300" />
      <div className="flex gap-2 text-sm">
        <button type="button" onClick={copy} disabled={missing}
          className="rounded-lg bg-lime-400 px-4 py-1.5 font-medium text-zinc-950 hover:bg-lime-300 disabled:opacity-50">
          {copied ? "Copied" : "Copy to clipboard"}
        </button>
        <button type="button" onClick={download} disabled={missing}
          className="rounded-lg border border-white/15 px-4 py-1.5 hover:border-white/30 disabled:opacity-50">
          Download .txt
        </button>
      </div>
    </section>
  );
}
