/** Small per-server-instance cache: entries expire after `ttl` ms, the oldest go first past `max`.
 *  `get` returns undefined on a miss, so a cached `null` still counts as a hit. */
export function ttlMap<V>(max: number, ttl = 30 * 60_000) {
  const m = new Map<string, { at: number; v: V }>();
  return {
    get(k: string): V | undefined {
      const h = m.get(k);
      return h && Date.now() - h.at < ttl ? h.v : undefined;
    },
    set(k: string, v: V) {
      m.delete(k);
      m.set(k, { at: Date.now(), v });
      while (m.size > max) m.delete(m.keys().next().value!);
    },
  };
}
