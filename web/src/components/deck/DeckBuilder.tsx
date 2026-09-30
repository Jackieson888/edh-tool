"use client";
import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { CardSearch } from "@/components/CardSearch";
import { ColorIndicator } from "@/components/Mana";
import { CommanderSuggestions } from "@/components/deck/CommanderSuggestions";
import { DeckCards } from "@/components/deck/DeckCards";
import { ExportPanel } from "@/components/deck/ExportPanel";
import { Recommendations } from "@/components/deck/Recommendations";
import { CutSuggestions } from "@/components/deck/CutSuggestions";
import { AnalyticsPanel } from "@/components/deck/AnalyticsPanel";
import { ThemePanel } from "@/components/deck/ThemePanel";
import {
  addCard,
  moveCard,
  openedDeck,
  renameDeck,
  setQty,
  setCommanders,
  setTheme,
  useDeck,
} from "@/lib/deckStore";
import { commanderColors, mainCount } from "@/lib/deckView";
import { rememberCards, useCards } from "@/lib/useCards";
import { useAnalysis } from "@/lib/useAnalysis";
import { useStats } from "@/lib/useStats";
import { useCuts } from "@/lib/useCuts";
import type { CardLite } from "@/lib/types";

const isCommander = (c: CardLite) => !!c.commander_eligible;

export function DeckBuilder({ id }: { id: string }) {
  const { ready, deck } = useDeck(id);
  const [reroll, setReroll] = useState(0);
  const [tab, setTab] = useState<"main" | "maybe">("main");
  const [changing, setChanging] = useState(false);
  const analysis = useAnalysis(deck, reroll);
  const stats = useStats(deck);
  const cuts = useCuts(deck);

  useEffect(() => {
    openedDeck(id);
  }, [id]);

  const ids = useMemo(
    () =>
      deck ? [...deck.commanders, ...deck.cards.map((c) => c.oracle_id)] : [],
    [deck],
  );
  const cards = useCards(ids);
  const [nameDraft, setNameDraft] = useState<string | null>(null);

  if (!ready) return <p className="text-sm text-zinc-500">Loading…</p>;
  if (!deck) {
    return (
      <div className="space-y-3">
        <p>
          This deck isn&apos;t in this browser. Decks are stored locally, so
          they don&apos;t follow you between devices.
        </p>
        <Link href="/decks" className="text-lime-300 hover:text-lime-200">
          Back to my decks
        </Link>
      </div>
    );
  }

  const colors = commanderColors(deck, cards);
  const cmd = deck.commanders
    .map((c) => cards.get(c))
    .filter((c): c is CardLite => !!c);
  // Themes the deck is going for (pinned, or inferred in auto mode); "" until analysis has them.
  const themeName =
    analysis.data?.active
      .map((id) => analysis.data?.themes.find((t) => t.id === id)?.name)
      .filter(Boolean)
      .join(" + ") ?? "";
  const art = cmd.find((c) => c.art_crop)?.art_crop;
  const total = mainCount(deck);
  const mainIds = deck.cards
    .filter((c) => c.board === "main")
    .map((c) => c.oracle_id);
  const maybeN = deck.cards
    .filter((c) => c.board === "maybe")
    .reduce((a, c) => a + c.qty, 0);

  const pickCommander = (c: CardLite) => {
    rememberCards([c]);
    setCommanders(deck.id, [c.oracle_id]);
    setChanging(false);
  };
  const onAdd = (c: CardLite, board: "main" | "maybe") => {
    rememberCards([c]);
    addCard(deck.id, c.oracle_id, board);
  };

  return (
    <div className="space-y-8">
      <header
        className={`flex flex-wrap items-end justify-between gap-4 mb-0 ${art ? "rounded-xl bg-cover bg-center py-5 px-2 sm:py-6 sm:px-4" : ""}`}
        style={
          art
            ? {
                // scrim: darker on the left where the text sits, plus a light overall tint
                backgroundImage: `linear-gradient(90deg, rgba(9,9,11,0.92) 0%, rgba(9,9,11,0.75) 45%, rgba(9,9,11,0.55) 100%), url("${encodeURI(art)}")`,
              }
            : undefined
        }
      >
        <div className="min-w-0 space-y-2">
          <input
            aria-label="Deck name"
            value={nameDraft ?? deck.name}
            onChange={(e) => setNameDraft(e.target.value)}
            onBlur={() => {
              if (nameDraft !== null) renameDeck(deck.id, nameDraft);
              setNameDraft(null);
            }}
            onKeyDown={(e) => {
              if (e.key === "Enter") e.currentTarget.blur();
            }}
            className="w-full min-w-0 bg-transparent text-3xl font-semibold tracking-tight outline-none focus:ring-1 focus:ring-lime-400/50"
          />
          <p className="text-sm text-zinc-500">{themeName}</p>
        </div>
        <CardSearch
          onPick={(c) => onAdd(c, "main")}
          placeholder="Add Card"
          className="w-full sm:w-72 my-4"
        />
        <div className="flex items-baseline justify-between gap-2 w-full">
          {deck.commanders.length > 0 && !changing ? (
            <p className="flex items-center gap-2 text-lg">
              {cmd.map((c) => c.name).join(" + ") || "Loading…"}
              {colors && (
                <ColorIndicator colors={[...colors]} className="text-base" />
              )}
            </p>
          ) : (
            <div className="space-y-4">
              <CardSearch
                onPick={pickCommander}
                filter={isCommander}
                placeholder="Search for a commander…"
                className="max-w-md"
              />
              {mainIds.length > 0 && (
                <div className="space-y-2">
                  <p className="text-sm text-zinc-400">
                    Or pick one that fits your {mainIds.length} cards:
                  </p>
                  <CommanderSuggestions
                    ids={mainIds}
                    exclude={deck.commanders}
                    onChoose={(s) => {
                      setCommanders(deck.id, [s.oracle_id]);
                      setChanging(false);
                    }}
                  />
                </div>
              )}
            </div>
          )}
          {deck.commanders.length > 0 && (
            <button
              type="button"
              onClick={() => setChanging((v) => !v)}
              className="text-xs text-lime-300 hover:text-lime-200"
            >
              {changing ? "Cancel" : "Change"}
            </button>
          )}
        </div>
      </header>

      <section className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <div role="tablist" className="flex gap-1 text-sm">
            {(["main", "maybe"] as const).map((b) => (
              <button
                key={b}
                type="button"
                role="tab"
                aria-selected={tab === b}
                onClick={() => setTab(b)}
                className={`rounded-lg px-3 py-1.5 ${tab === b ? "bg-white/10 text-zinc-100" : "text-zinc-400 hover:text-zinc-200"}`}
              >
                {b === "main"
                  ? `Deck (${total - deck.commanders.length})`
                  : `Maybeboard (${maybeN})`}
              </button>
            ))}
          </div>
        </div>
        <DeckCards
          deck={deck}
          board={tab}
          cards={cards}
          colors={colors}
          themeOf={analysis.data?.cardThemes}
        />
      </section>

      {deck.cards.some((c) => c.board === "main") && (
        <AnalyticsPanel
          data={stats.data}
          error={stats.error}
          commanders={deck.commanders}
          exclude={deck.cards.map((c) => c.oracle_id)}
          onAdd={(c, board) => onAdd(c, board)}
        />
      )}

      {deck.commanders.length === 0 ? (
        <p className="rounded-xl border border-dashed border-white/15 p-6 text-sm text-zinc-400">
          Choose a commander to see your deck&apos;s themes and card
          recommendations.
        </p>
      ) : (
        <>
          {analysis.error && (
            <p className="text-sm text-red-300">{analysis.error}</p>
          )}
          {analysis.data ? (
            <>
              <ThemePanel
                data={analysis.data}
                state={deck.theme}
                onChange={(s) => setTheme(deck.id, s)}
              />
              {cuts.data && cuts.data.total >= 90 && (
                <CutSuggestions
                  data={cuts.data}
                  loading={cuts.loading}
                  commanderName={cmd[0]?.name ?? "your commander"}
                  cards={cards}
                  onMaybe={(oid) => moveCard(deck.id, oid, "maybe")}
                  onRemove={(oid) => setQty(deck.id, oid, "main", 0)}
                />
              )}
              <Recommendations
                data={analysis.data}
                loading={analysis.loading}
                onAdd={(oid, board) => addCard(deck.id, oid, board)}
                onReroll={() => setReroll((n) => n + 1)}
              />
              {analysis.data.recs.length === 0 && !analysis.loading && (
                <p className="text-sm text-zinc-500">
                  No recommendations yet: this commander has no viable themes
                  generated.
                </p>
              )}
            </>
          ) : (
            !analysis.error && (
              <p className="text-sm text-zinc-500">Analyzing your deck…</p>
            )
          )}
        </>
      )}

      <ExportPanel
        deck={deck}
        cards={cards}
        categories={analysis.data?.cardThemes}
      />
    </div>
  );
}
