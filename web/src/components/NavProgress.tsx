"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";

/** Thin top bar that starts the moment an internal link is clicked and finishes when the
 *  new route has rendered, so slow pages never look like a dead click. */
export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const [pct, setPct] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  const stop = () => { if (timer.current) clearInterval(timer.current); timer.current = null; };

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (hide.current) clearTimeout(hide.current);
      stop();
      setState("loading"); setPct(8);
      // creep toward 90% and wait there for the route
      timer.current = setInterval(() => setPct((p) => p + (90 - p) * 0.08), 200);
    };
    document.addEventListener("click", onClick, true);
    return () => { document.removeEventListener("click", onClick, true); stop(); };
  }, []);

  useEffect(() => {
    // Route committed. A loading.tsx skeleton commits immediately, so keep the bar going
    // until the skeleton (aria-busy) has been replaced by the real page.
    if (state !== "loading") return;
    const poll = setInterval(() => {
      if (document.querySelector('[aria-busy="true"]')) return;
      clearInterval(poll); stop(); setPct(100); setState("done");
      hide.current = setTimeout(() => { setState("idle"); setPct(0); }, 350);
    }, 100);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, state]);

  if (state === "idle") return null;
  return (
    <div aria-hidden="true" className="pointer-events-none fixed inset-x-0 top-0 z-[60] h-0.5">
      <div className={`h-full bg-lime-400 shadow-[0_0_8px_rgba(163,230,53,0.7)] transition-[width,opacity] duration-200 ${state === "done" ? "opacity-0" : "opacity-100"}`}
        style={{ width: `${pct}%` }} />
    </div>
  );
}
