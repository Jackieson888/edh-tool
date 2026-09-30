"use client";
import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RiffleLoader } from "@/components/RiffleLoader";

/** Riffle-shuffle loader that appears the moment an internal link is clicked and goes away
 *  when the new route has rendered, so slow pages never look like a dead click. */
export function NavProgress() {
  const pathname = usePathname();
  const [state, setState] = useState<"idle" | "loading" | "done">("idle");
  const hide = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = (e.target as Element | null)?.closest?.("a");
      if (!a || a.target === "_blank" || a.hasAttribute("download")) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin) return;
      if (url.pathname === location.pathname && url.search === location.search) return;
      if (hide.current) clearTimeout(hide.current);
      setState("loading");
    };
    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  useEffect(() => {
    // Route committed. A loading.tsx skeleton commits immediately, so keep the loader going
    // until the skeleton (aria-busy) has been replaced by the real page.
    if (state !== "loading") return;
    const poll = setInterval(() => {
      if (document.querySelector('[aria-busy="true"]')) return;
      clearInterval(poll); setState("done");
      hide.current = setTimeout(() => setState("idle"), 250);
    }, 100);
    return () => clearInterval(poll);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname, state]);

  if (state === "idle") return null;
  return (
    <div
      className={`pointer-events-none fixed inset-x-0 top-16 z-[60] flex justify-center transition-opacity duration-200 ${state === "done" ? "opacity-0" : "opacity-100"}`}
    >
      <div className="rounded-lg border border-white/10 bg-zinc-900/90 px-4 py-2 shadow-lg backdrop-blur">
        <RiffleLoader size="sm" withText />
      </div>
    </div>
  );
}
