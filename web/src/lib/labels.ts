// Human-readable names for base tags. Anything not listed falls back to "snake_case" -> "Snake case".
const SPECIAL: Record<string, string> = {
  plus1_counters: "+1/+1 counters",
  minus1_counters: "-1/-1 counters",
  rad_counters: "Rad counters",
  oil_counters: "Oil counters",
  sac_outlet: "Sac outlets",
  sac_fodder: "Sac fodder",
  etb_value: "ETB value",
  cast_from_exile: "Cast from exile",
  poison_direct: "Direct poison",
  group_slug: "Group slug",
  go_wide: "Go wide",
  big_power: "Big power",
};

export function tagLabel(tag: string): string {
  if (tag.startsWith("typal:")) return tag.slice(6);
  if (SPECIAL[tag]) return SPECIAL[tag];
  const s = tag.replace(/_/g, " ");
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export const COLOR_NAMES: Record<string, string> = { W: "White", U: "Blue", B: "Black", R: "Red", G: "Green" };
