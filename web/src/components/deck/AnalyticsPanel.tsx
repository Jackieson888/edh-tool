"use client";
import { useState, type ReactNode } from "react";
import type { DeckAnalytics, RoleStat } from "@edh-tool/engine/analytics";
import { SplitAddButton } from "@/components/deck/SplitAddButton";
import type { Board, CardLite } from "@/lib/types";
import { ManaSymbol } from "@/components/Mana";
import { tagLabel } from "@/lib/labels";

const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
  C: "Colorless",
};
const pct = (x: number, d = 0) => `${(x * 100).toFixed(d)}%`;

/** Single-hue chart color (dataviz slot 1, dark step; passes the palette validator on the dark surface). */
const STYLE = `.viz{--bar:#3987e5;--track:rgb(255 255 255/.07);--warn:#fbbf24;--good:#86efac}`; // the site is dark-only

function Card({
  title,
  note,
  children,
  table,
}: {
  title: string;
  note?: string;
  children: ReactNode;
  table?: ReactNode;
}) {
  const [showTable, setShowTable] = useState(false);
  return (
    <section className="viz space-y-3 rounded-xl border border-white/10 p-4">
      <div className="flex items-baseline justify-between gap-2">
        <h3 className="text-sm font-semibold">{title}</h3>
        {table && (
          <button
            type="button"
            onClick={() => setShowTable((v) => !v)}
            aria-pressed={showTable}
            className="text-xs text-lime-300 hover:text-lime-200"
          >
            {showTable ? "Chart" : "Table"}
          </button>
        )}
      </div>
      {showTable && table ? table : children}
      {note && <p className="text-xs text-zinc-500">{note}</p>}
    </section>
  );
}

function Table({
  head,
  rows,
}: {
  head: string[];
  rows: (string | number)[][];
}) {
  return (
    <table className="w-full text-xs">
      <thead>
        <tr>
          {head.map((h, i) => (
            <th
              key={h}
              className={`pb-1 font-medium text-zinc-400 ${i ? "text-right" : "text-left"}`}
            >
              {h}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {rows.map((r, i) => (
          <tr key={i} className="border-t border-white/5">
            {r.map((c, j) => (
              <td
                key={j}
                className={`py-1 ${j ? "text-right tabular-nums" : ""}`}
              >
                {c}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

/** One row per category: label, bar, value. Single hue, bars from zero, value printed on the row. */
function HBars({
  rows,
  max,
}: {
  rows: {
    key: string;
    label: ReactNode;
    value: number;
    text: string;
    tip: string;
  }[];
  max?: number;
}) {
  const m = max ?? Math.max(1, ...rows.map((r) => r.value));
  return (
    <ul className="space-y-1.5">
      {rows.map((r) => (
        <li
          key={r.key}
          title={r.tip}
          className="grid grid-cols-[7.5rem_1fr_3.5rem] items-center gap-2 text-xs"
        >
          <span className="flex items-center gap-1.5 truncate text-zinc-300">
            {r.label}
          </span>
          <span className="h-3 rounded-r bg-[var(--track)]" aria-hidden="true">
            <span
              className="block h-3 rounded-r bg-[var(--bar)]"
              style={{ width: `${Math.max(2, (r.value / m) * 100)}%` }}
            />
          </span>
          <span className="text-right tabular-nums text-zinc-200">
            {r.text}
          </span>
        </li>
      ))}
    </ul>
  );
}

function Stat({
  label,
  value,
  sub,
}: {
  label: string;
  value: ReactNode;
  sub?: string;
}) {
  return (
    <div className="rounded-xl border border-white/10 p-3">
      <p className="text-xs text-zinc-400">{label}</p>
      <p className="text-2xl font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-xs text-zinc-500">{sub}</p>}
    </div>
  );
}

const STATUS = {
  low: { icon: "▼", text: "Low", cls: "text-[var(--warn)]" },
  ok: { icon: "✓", text: "In range", cls: "text-[var(--good)]" },
  high: { icon: "▲", text: "High", cls: "text-[var(--warn)]" },
} as const;

/** Click a role to see which cards fill it; when it's short (or you just want options), fetch picks that fit the commander. */
function RoleRow({
  r,
  commanders,
  exclude,
  onAdd,
}: {
  r: RoleStat;
  commanders: string[];
  exclude: string[];
  onAdd?: (c: CardLite, board: Board) => void;
}) {
  const [open, setOpen] = useState(false);
  const [picks, setPicks] = useState<CardLite[] | null>(null);
  const [busy, setBusy] = useState(false);
  const s = STATUS[r.status];
  const canPick = r.id !== "tutors" && commanders.length > 0 && !!onAdd;
  const load = async () => {
    setBusy(true);
    try {
      const res = await fetch("/api/deck/role-picks", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ commanders, exclude, role: r.id }),
      });
      const j = await res.json();
      setPicks(res.ok ? j.cards : []);
    } catch {
      setPicks([]);
    }
    setBusy(false);
  };
  const span = Math.max(r.max * 1.5, 1);
  return (
    <li title={`${r.label}: ${r.count} (typical ${r.min}–${r.max})`}>
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
        className="grid w-full grid-cols-[7.5rem_1fr_5.5rem] items-center gap-2 rounded text-left text-xs hover:bg-white/5"
      >
        <span className="text-zinc-300">
          <span aria-hidden="true" className="mr-1 text-zinc-500">
            {open ? "▾" : "▸"}
          </span>
          {r.label}
        </span>
        <span
          className="relative h-3 rounded bg-[var(--track)]"
          aria-hidden="true"
        >
          <span
            className="absolute top-0 h-3 rounded-r bg-[var(--bar)]"
            style={{
              left: 0,
              width: `${Math.min(100, (r.count / span) * 100)}%`,
            }}
          />
          <span
            className="absolute -top-0.5 h-4 border-x border-zinc-400/60"
            style={{
              left: `${(r.min / span) * 100}%`,
              width: `${((r.max - r.min) / span) * 100}%`,
            }}
          />
        </span>
        <span className={`text-right tabular-nums ${s.cls}`}>
          {r.count} <span aria-hidden="true">{s.icon}</span> {s.text}
        </span>
      </button>
      {open && (
        <div className="mt-2 space-y-3 rounded-lg bg-white/[0.03] p-3 text-xs">
          {r.cards.length ? (
            <p className="leading-relaxed text-zinc-300">
              {r.cards.map((c, i) => (
                <span key={c.oracle_id}>
                  {i > 0 && " · "}
                  {c.qty > 1 && `${c.qty}× `}
                  {c.name}
                  <span className="text-zinc-500"> {c.cmc}</span>
                </span>
              ))}
            </p>
          ) : (
            <p className="text-zinc-500">
              No {r.label.toLowerCase()} in the deck yet.
            </p>
          )}
          {r.cards.length > 0 && (
            <p className="text-[10px] text-zinc-500">
              Small number = mana value.
            </p>
          )}
          {canPick && (
            <div className="space-y-2">
              {picks === null ? (
                <button
                  type="button"
                  onClick={load}
                  disabled={busy}
                  className="rounded-lg border border-white/15 px-2.5 py-1 text-zinc-300 hover:border-white/30 disabled:opacity-50"
                >
                  {busy
                    ? "Finding…"
                    : `Suggest ${r.label.toLowerCase()} for this commander`}
                </button>
              ) : picks.length === 0 ? (
                <p className="text-zinc-500">No suggestions found.</p>
              ) : (
                <ul className="space-y-1">
                  {picks.map((c) => (
                    <li
                      key={c.oracle_id}
                      className="flex items-center justify-between gap-2"
                    >
                      <span className="truncate">
                        {c.name}{" "}
                        <span className="text-zinc-500">
                          {c.type_line?.split(" — ")[0]}
                        </span>
                      </span>
                      <SplitAddButton
                        size="sm"
                        label="Add"
                        className="shrink-0"
                        onAdd={(board) => {
                          onAdd!(c, board);
                          setPicks(
                            (p) =>
                              p && p.filter((x) => x.oracle_id !== c.oracle_id),
                          );
                        }}
                      />
                    </li>
                  ))}
                </ul>
              )}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

export function AnalyticsPanel({
  data,
  error,
  commanders = [],
  exclude = [],
  onAdd,
}: {
  data: DeckAnalytics | null;
  error: string | null;
  commanders?: string[];
  exclude?: string[];
  onAdd?: (c: CardLite, board: Board) => void;
}) {
  if (error) return <p className="text-sm text-red-300">{error}</p>;
  if (!data)
    return <p className="text-sm text-zinc-500">Crunching the numbers…</p>;
  if (!data.total) return null;
  const a = data;
  const maxCurve = Math.max(1, ...a.curve.map((c) => c.count));
  const openMax = Math.max(...a.landOdds.opening);
  const shortDeck = a.total < 90;

  return (
    <section className="space-y-4">
      <style>{STYLE}</style>
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="text-lg font-semibold">Deck analytics</h2>
        <span className="text-xs text-zinc-500">
          {a.total} cards counted (commander excluded)
          {shortDeck && ": odds assume the deck you have so far"}
        </span>
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat
          label="Lands"
          value={a.lands}
          sub={`${a.nonlands} spells · ${pct(a.total ? a.lands / a.total : 0)} lands`}
        />
        <Stat
          label="Avg mana value"
          value={a.mv.avgNonland.toFixed(2)}
          sub={`nonland · median ${a.mv.median}`}
        />
        <Stat
          label="Bracket (estimate)"
          value={
            <span title={a.bracket.reasons.join("; ")}>
              {a.bracket.bracket}{" "}
              <span className="text-base font-normal text-zinc-400">
                {a.bracket.name}
              </span>
            </span>
          }
          sub={`${a.bracket.gameChangers.length} Game Changers`}
        />
        <Stat
          label="Est. price"
          value={`$${Math.round(a.priceUsd).toLocaleString()}`}
          sub="approximate, USD"
        />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card
          title="Mana curve"
          note="Nonland cards by mana value."
          table={
            <Table
              head={["Mana value", "Cards"]}
              rows={a.curve.map((c) => [c.label, c.count])}
            />
          }
        >
          <div
            className="flex h-36 items-end gap-2"
            role="img"
            aria-label={`Mana curve: ${a.curve.map((c) => `${c.label}: ${c.count}`).join(", ")}`}
          >
            {a.curve.map((c) => (
              <div
                key={c.mv}
                title={`${c.count} card${c.count === 1 ? "" : "s"} at mana value ${c.label}`}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-xs tabular-nums text-zinc-300">
                  {c.count || ""}
                </span>
                <div
                  className="w-full rounded-t bg-[var(--bar)]"
                  style={{
                    height: `${(c.count / maxCurve) * 85}%`,
                    minHeight: c.count ? 3 : 0,
                  }}
                />
                <span className="text-xs text-zinc-400">{c.label}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Card types"
          table={
            <Table
              head={["Type", "Cards"]}
              rows={a.types.map((t) => [t.type, t.count])}
            />
          }
        >
          <HBars
            rows={a.types.map((t) => ({
              key: t.type,
              label: t.type,
              value: t.count,
              text: String(t.count),
              tip: `${t.type}: ${t.count} (${pct(t.count / a.total)})`,
            }))}
          />
        </Card>

        <Card
          title="Color pips"
          note="Colored symbols in mana costs: what your spells ask of your mana base."
          table={
            <Table
              head={["Color", "Pips", "Share"]}
              rows={a.colors
                .filter((c) => c.pips)
                .map((c) => [COLOR_NAMES[c.color], c.pips, pct(c.pipShare)])}
            />
          }
        >
          <HBars
            rows={a.colors
              .filter((c) => c.pips)
              .map((c) => ({
                key: c.color,
                label: (
                  <>
                    <ManaSymbol symbol={c.color} decorative />
                    {COLOR_NAMES[c.color]}
                  </>
                ),
                value: c.pips,
                text: pct(c.pipShare),
                tip: `${COLOR_NAMES[c.color]}: ${c.pips} pips (${pct(c.pipShare)})`,
              }))}
          />
        </Card>

        <Card
          title="Mana sources"
          note="Cards that can make each color (lands and rocks). The tick is a rule-of-thumb target from that color's share of your pips; it catches big mismatches, not fine tuning."
          table={
            <Table
              head={["Color", "Sources", "Lands", "Target"]}
              rows={a.colors
                .filter((c) => c.sources)
                .map((c) => [
                  COLOR_NAMES[c.color],
                  c.sources,
                  c.landSources,
                  a.sourceTargets?.find((t) => t.color === c.color)?.target ??
                    "–",
                ])}
            />
          }
        >
          <ul className="space-y-1.5">
            {a.colors
              .filter((c) => c.sources)
              .map((c) => {
                const t = a.sourceTargets?.find((x) => x.color === c.color);
                const s = t ? STATUS[t.status] : null;
                const top = Math.max(
                  1,
                  ...a.colors.map((x) => x.sources),
                  ...(a.sourceTargets ?? []).map((x) => x.target ?? 0),
                );
                return (
                  <li
                    key={c.color}
                    title={`${COLOR_NAMES[c.color]}: ${c.sources} sources (${c.landSources} lands)${t ? `, target about ${t.target}` : ""}`}
                    className="grid grid-cols-[6rem_1fr_6.5rem] items-center gap-2 text-xs"
                  >
                    <span className="flex items-center gap-1.5 text-zinc-300">
                      <ManaSymbol symbol={c.color} decorative />
                      {COLOR_NAMES[c.color]}
                    </span>
                    <span
                      className="relative h-3 rounded-r bg-[var(--track)]"
                      aria-hidden="true"
                    >
                      <span
                        className="block h-3 rounded-r bg-[var(--bar)]"
                        style={{
                          width: `${Math.max(2, (c.sources / top) * 100)}%`,
                        }}
                      />
                      {t && (
                        <span
                          className="absolute -top-0.5 h-4 border-l-2 border-zinc-200/70"
                          style={{ left: `${(t.target / top) * 100}%` }}
                        />
                      )}
                    </span>
                    <span
                      className={`text-right tabular-nums ${s ? s.cls : "text-zinc-300"}`}
                    >
                      {c.sources}
                      {t && (
                        <>
                          {" "}
                          / ~{t.target}{" "}
                          <span aria-hidden="true">{s!.icon}</span> {s!.text}
                        </>
                      )}
                    </span>
                  </li>
                );
              })}
          </ul>
        </Card>

        <Card
          title="Land odds"
          note="Land suggestion adapted from Frank Karsten's Commander formula (average mana value and cheap ramp/draw); it counts ramp, so a ramp-heavy deck wants fewer lands. Odds assume no mulligan and no ramp or draw."
          table={
            <Table
              head={["Turn", "On the play", "On the draw"]}
              rows={a.landOdds.turns.map((t) => [
                t.turn,
                pct(t.onPlay),
                pct(t.onDraw),
              ])}
            />
          }
        >
          <p className="text-sm">
            <b>{pct(a.landOdds.nextDraw, 1)}</b> chance the next card is a land
            · <b>{pct(a.landOdds.keep)}</b> of opening hands have 2–5 lands.
          </p>
          {a.landSuggestion && (
            <p
              className="text-sm"
              title={`${a.landSuggestion.formula} = ${a.landSuggestion.raw}`}
            >
              Suggested lands:{" "}
              <b>
                {a.landSuggestion.min}–{a.landSuggestion.max}
              </b>
              {a.lands < a.landSuggestion.min ? (
                <span className="text-[var(--warn)]">
                  {" "}
                  · you have {a.lands} ▼ low
                </span>
              ) : a.lands > a.landSuggestion.max ? (
                <span className="text-[var(--warn)]">
                  {" "}
                  · you have {a.lands} ▲ high
                </span>
              ) : (
                <span className="text-[var(--good)]">
                  {" "}
                  · you have {a.lands} ✓
                </span>
              )}
            </p>
          )}
          <p className="text-xs text-zinc-400">
            Land drops on curve, on the play:{" "}
            {a.landOdds.turns
              .slice(1, 6)
              .map((t) => `T${t.turn} ${pct(t.onPlay)}`)
              .join(" · ")}
          </p>
          <p className="text-xs text-zinc-400">Lands in your opening 7</p>
          <div
            className="flex h-24 items-end gap-2"
            role="img"
            aria-label={`Opening hand land counts: ${a.landOdds.opening.map((p, k) => `${k}: ${pct(p, 1)}`).join(", ")}`}
          >
            {a.landOdds.opening.map((p, k) => (
              <div
                key={k}
                title={`${pct(p, 1)} of opening hands have ${k} land${k === 1 ? "" : "s"}`}
                className="flex h-full flex-1 flex-col items-center justify-end gap-1"
              >
                <span className="text-[10px] tabular-nums text-zinc-300">
                  {p >= 0.005 ? pct(p) : ""}
                </span>
                <div
                  className="w-full rounded-t bg-[var(--bar)]"
                  style={{
                    height: `${openMax ? (p / openMax) * 75 : 0}%`,
                    minHeight: p >= 0.005 ? 2 : 0,
                  }}
                />
                <span className="text-xs text-zinc-400">{k}</span>
              </div>
            ))}
          </div>
        </Card>

        <Card
          title="Deck roles"
          note="Typical Commander ranges for a 99-card list: a guide, not a rule. Uses the AI tags. Click a role to see its cards."
          table={
            <Table
              head={["Role", "Cards", "Range", "Status"]}
              rows={a.roles.map((r) => [
                r.label,
                r.count,
                `${r.min}–${r.max}`,
                STATUS[r.status].text,
              ])}
            />
          }
        >
          <ul className="space-y-2">
            {a.roles.map((r) => (
              <RoleRow
                key={r.id}
                r={r}
                commanders={commanders}
                exclude={exclude}
                onAdd={onAdd}
              />
            ))}
          </ul>
        </Card>

        <Card
          title="Top tags"
          note={`${pct(a.tagCoverage)} of cards carry AI tags; cards can have several.`}
          table={
            <Table
              head={["Tag", "Cards", "Share"]}
              rows={a.tags
                .slice(0, 15)
                .map((t) => [tagLabel(t.tag), t.count, pct(t.share)])}
            />
          }
        >
          <HBars
            rows={a.tags.slice(0, 12).map((t) => ({
              key: t.tag,
              label: tagLabel(t.tag),
              value: t.count,
              text: pct(t.share),
              tip: `${tagLabel(t.tag)}: ${t.count} cards (${pct(t.share)} of the deck)`,
            }))}
          />
        </Card>

        <Card
          title={`Bracket estimate: ${a.bracket.bracket} (${a.bracket.name})`}
          note="An estimate from Game Changers, extra turns, mass land denial and tutors. Combos and deck speed aren't detected, so treat it as a floor."
        >
          <ul className="list-disc space-y-1 pl-5 text-xs text-zinc-300">
            {a.bracket.reasons.map((r) => (
              <li key={r}>{r}</li>
            ))}
          </ul>
          {(
            [
              ["Game Changers", a.bracket.gameChangers],
              ["Extra turns", a.bracket.extraTurns],
              ["Mass land denial", a.bracket.massLandDenial],
              ["Tutors", a.bracket.tutors],
            ] as const
          )
            .filter(([, l]) => l.length)
            .map(([label, l]) => (
              <p key={label} className="text-xs text-zinc-400">
                <span className="text-zinc-200">{label}:</span> {l.join(", ")}
              </p>
            ))}
        </Card>
      </div>
    </section>
  );
}
