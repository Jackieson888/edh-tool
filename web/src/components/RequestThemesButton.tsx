"use client";
import { useEffect, useState } from "react";
import { Spinner } from "@/components/Skeleton";

const SEEN_KEY = "edh:themeRequests";
const CLIENT_KEY = "edh:clientId";

function read<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function write(key: string, value: unknown) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch { /* storage unavailable */ }
}
function clientId(): string {
  const existing = read<string | null>(CLIENT_KEY, null);
  if (existing) return existing;
  const id = crypto.randomUUID();
  write(CLIENT_KEY, id);
  return id;
}

/** Lets a visitor ask for themes on a commander that doesn't have any yet. */
export function RequestThemesButton({ oracleId, className = "" }: { oracleId: string; className?: string }) {
  const [done, setDone] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { setDone(read<string[]>(SEEN_KEY, []).includes(oracleId)); }, [oracleId]);

  async function request() {
    setBusy(true); setError(null);
    try {
      const r = await fetch("/api/commanders/request-themes", {
        method: "POST", headers: { "content-type": "application/json" },
        body: JSON.stringify({ oracle_id: oracleId, client_id: clientId() }),
      });
      if (!r.ok) throw new Error((await r.json().catch(() => ({}))).error ?? "Couldn't send your request");
      write(SEEN_KEY, [...new Set([...read<string[]>(SEEN_KEY, []), oracleId])]);
      setDone(true);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Something went wrong");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className={`inline-flex flex-wrap items-center gap-2 ${className}`}>
      {done ? (
        <span className="rounded-lg border border-lime-400/40 px-3 py-1.5 text-xs text-lime-300">
          ✓ Requested. Thanks, we use these to pick which commanders to do next.
        </span>
      ) : (
        <button type="button" onClick={request} disabled={busy}
          className="inline-flex items-center gap-2 rounded-lg border border-white/15 px-3 py-1.5 text-xs font-medium text-zinc-200 transition hover:border-lime-400/50 hover:text-lime-300 disabled:opacity-70">
          {busy && <Spinner className="h-3.5 w-3.5" />}
          Request themes
        </button>
      )}
      {error && <span role="alert" className="text-xs text-red-300">{error}</span>}
    </span>
  );
}
