"use client";

import { useEffect, useRef } from "react";

/* eslint-disable @next/next/no-img-element -- Scryfall's CDN already serves sized images;
   Scryfall's guidelines ask that card images aren't altered, so no re-encoding/cropping.
   The tilt/glare below is a CSS transform plus an overlay; the image itself is untouched. */

const MAX_TILT = 10; // degrees
const SCROLL_TILT = 8; // degrees, for touch / no-hover devices

export function CardImage({ src, alt, className = "" }: { src?: string | null; alt: string; className?: string }) {
  const wrapRef = useRef<HTMLDivElement>(null);
  const tiltRef = useRef<HTMLDivElement>(null);

  // Apply a tilt. x/y are -1..1 (x: left→right, y: top→bottom).
  const setTilt = (x: number, y: number, lift = 1) => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--rx", `${(-y * MAX_TILT).toFixed(2)}deg`);
    el.style.setProperty("--ry", `${(x * MAX_TILT).toFixed(2)}deg`);
    el.style.setProperty("--scale", String(lift));
    el.style.setProperty("--gx", `${(50 + x * 40).toFixed(1)}%`);
    el.style.setProperty("--gy", `${(50 + y * 40).toFixed(1)}%`);
    el.style.setProperty("--glare", "1");
  };

  const reset = () => {
    const el = tiltRef.current;
    if (!el) return;
    el.style.setProperty("--rx", "0deg");
    el.style.setProperty("--ry", "0deg");
    el.style.setProperty("--scale", "1");
    el.style.setProperty("--glare", "0");
  };

  // Scroll-driven tilt for devices without hover (phones/tablets): the card leans
  // as it travels through the viewport, so the effect is visible without touching it.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const canHover = window.matchMedia("(hover: hover) and (pointer: fine)").matches;
    if (reduced || canHover) return;

    let frame = 0;
    const update = () => {
      frame = 0;
      const r = wrap.getBoundingClientRect();
      const vh = window.innerHeight;
      // -1 at the top of the viewport, 0 at center, 1 at the bottom
      const p = Math.max(-1, Math.min(1, (r.top + r.height / 2 - vh / 2) / (vh / 2)));
      const el = tiltRef.current;
      if (!el) return;
      el.style.setProperty("--rx", `${(-p * SCROLL_TILT).toFixed(2)}deg`);
      el.style.setProperty("--ry", `${(p * SCROLL_TILT * 0.6).toFixed(2)}deg`);
      el.style.setProperty("--gx", `${(50 + p * 45).toFixed(1)}%`);
      el.style.setProperty("--gy", `${(50 + p * 45).toFixed(1)}%`);
      el.style.setProperty("--glare", String((1 - Math.abs(p)) * 0.9));
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(update);
    };

    // Only listen while the card is on screen.
    let listening = false;
    const io = new IntersectionObserver(([entry]) => {
      if (entry.isIntersecting && !listening) {
        listening = true;
        window.addEventListener("scroll", onScroll, { passive: true });
        update();
      } else if (!entry.isIntersecting && listening) {
        listening = false;
        window.removeEventListener("scroll", onScroll);
      }
    });
    io.observe(wrap);
    return () => {
      io.disconnect();
      window.removeEventListener("scroll", onScroll);
      if (frame) cancelAnimationFrame(frame);
    };
  }, []);

  if (!src) {
    return (
      <div className={`grid aspect-[488/680] place-items-center rounded-[4.75%] bg-zinc-800 p-4 text-center text-sm ${className}`}>
        {alt}
      </div>
    );
  }
  return (
    <div ref={wrapRef} className={`card-tilt-wrap ${className}`}
      style={{ perspective: "800px" }}
      onPointerMove={(e) => {
        if (e.pointerType !== "mouse") return;
        const r = e.currentTarget.getBoundingClientRect();
        setTilt(((e.clientX - r.left) / r.width) * 2 - 1, ((e.clientY - r.top) / r.height) * 2 - 1, 1.03);
      }}
      onPointerLeave={(e) => { if (e.pointerType === "mouse") reset(); }}>
      <div ref={tiltRef} className="relative rounded-[4.75%] will-change-transform motion-reduce:!transform-none"
        style={{
          transform: "rotateX(var(--rx, 0deg)) rotateY(var(--ry, 0deg)) scale(var(--scale, 1))",
          transition: "transform 150ms ease-out",
          transformStyle: "preserve-3d",
        }}>
        <img src={src} alt={alt} loading="lazy" width={488} height={680}
          className="aspect-[488/680] h-auto w-full rounded-[4.75%] shadow-lg shadow-black/40" />
        <div aria-hidden className="pointer-events-none absolute inset-0 rounded-[4.75%] motion-reduce:hidden"
          style={{
            opacity: "calc(var(--glare, 0) * 0.35)",
            background: "radial-gradient(circle at var(--gx, 50%) var(--gy, 50%), rgba(255,255,255,0.9), transparent 55%)",
            mixBlendMode: "soft-light",
            transition: "opacity 150ms ease-out",
          }} />
      </div>
    </div>
  );
}
