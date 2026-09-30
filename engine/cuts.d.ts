import type { IndexEntry, Index, Theme } from "./score";

export interface CutReason {
  kind: "illegal" | "off_theme" | "redundant_role" | "redundant_tag" | "expensive" | "weak";
  theme?: string; fit?: number; tags?: string[];
  role?: string; label?: string; count?: number; max?: number; min?: number;
  tag?: string; cmc?: number; quality?: number;
}
export type CutImpact = "none" | "low" | "neutral";
export interface CutCandidate { oracle_id: string; name: string; cmc: number; qty: number; score: number; fit: number; reasons: CutReason[]; impact: CutImpact }
export interface CutResult {
  over: number; cuts: CutCandidate[]; flagged: number;
  overfullRoles: { id: string; label: string; count: number; max: number }[];
  shortRoles: { id: string; label: string; count: number; min: number }[];
}
export function impactOf(score: number, cfg?: Record<string, any>): CutImpact;
export const CUT_CONFIG: Record<string, unknown>;
export function suggestCuts(index: Index, commander: IndexEntry, themes: Theme[], rows: { oracle_id: string; qty?: number }[],
  opts?: { activeIds?: string[]; over?: number; cfg?: Record<string, unknown>; scoreCfg?: unknown }): CutResult;
