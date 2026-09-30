"use client";

/**
 * RiffleLoader — a riffle-shuffle loading indicator for EDH Tool.
 *
 * The deck splits into two halves, then the cards drop back in alternating
 * left/right order so they interleave and overlap, like a real riffle.
 *
 * Usage:
 *   <RiffleLoader />                         // medium, icon only
 *   <RiffleLoader size="lg" />               // page / panel loads
 *   <RiffleLoader size="sm" withText />      // inline, rotating flavor text
 *   <RiffleLoader size={36} cardCount={8} duration={2000} />
 *
 * Next.js route-level loading state (app/some-route/loading.tsx):
 *   export default function Loading() {
 *     return (
 *       <div className="grid min-h-[50vh] place-items-center">
 *         <RiffleLoader size="lg" withText />
 *       </div>
 *     );
 *   }
 */

import { useEffect, useRef, useState, type CSSProperties } from "react";

type RiffleSize = "sm" | "md" | "lg";

const SIZE_TO_WIDTH: Record<RiffleSize, number> = { sm: 18, md: 28, lg: 44 };

/** Real Magic cards are 63 x 88 mm. */
const CARD_ASPECT = 88 / 63;

export const DEFAULT_LOADING_MESSAGES = [
  "Shuffling your library…",
  "Tutoring for synergies…",
  "Scrying 2…",
  "Consulting the oracle…",
  "Mulliganing bad ideas…",
] as const;

export interface RiffleLoaderProps {
  /** Preset size or card width in px. Default "md". */
  size?: RiffleSize | number;
  /** Number of cards in the stack. Even numbers look best. Default 6. */
  cardCount?: number;
  /** Length of one full shuffle cycle in ms. Default 2600. */
  duration?: number;
  /** Card frame color. Defaults to the EDH Tool theme accent. */
  accentColor?: string;
  /** Card face color. Defaults to your --background CSS variable, then white. */
  cardColor?: string;
  /** Show rotating flavor text next to the cards. Default false. */
  withText?: boolean;
  /** Messages to cycle through when withText is on (one per shuffle). */
  messages?: readonly string[];
  /** Accessible label announced to screen readers. Default "Loading". */
  label?: string;
  className?: string;
  style?: CSSProperties;
}

const visuallyHidden: CSSProperties = {
  position: "absolute",
  width: 1,
  height: 1,
  padding: 0,
  margin: -1,
  overflow: "hidden",
  clip: "rect(0, 0, 0, 0)",
  whiteSpace: "nowrap",
  border: 0,
};

function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);

  useEffect(() => {
    const media = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReduced(media.matches);
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, []);

  return reduced;
}

export function RiffleLoader({
  size = "md",
  cardCount = 6,
  duration = 2600,
  accentColor = "#9ae600",
  cardColor = "var(--background, #ffffff)",
  withText = false,
  messages = DEFAULT_LOADING_MESSAGES,
  label = "Loading",
  className,
  style,
}: RiffleLoaderProps) {
  const stackRef = useRef<HTMLDivElement>(null);
  const reducedMotion = usePrefersReducedMotion();
  const [messageIndex, setMessageIndex] = useState(0);

  const cardWidth = typeof size === "number" ? size : SIZE_TO_WIDTH[size];
  const cardHeight = Math.round(cardWidth * CARD_ASPECT);
  const count = Math.max(2, Math.floor(cardCount));

  // Everything scales off a 44px-wide "design size".
  const unit = cardWidth / 44;
  const splitX = cardWidth * 0.62;
  const stackStep = 0.8 * unit;
  const borderWidth = Math.max(1, Math.round(1.5 * unit * 10) / 10);
  const radius = Math.max(2, Math.round(4 * unit));
  const innerInset = Math.max(2, Math.round(3 * unit));

  // Reserve room for the split and the lift so surrounding layout never jumps.
  const stageWidth = Math.ceil(cardWidth + splitX * 2 + cardWidth * 0.3);
  const stageHeight = Math.ceil(cardHeight + (10 + count) * unit);

  // Drive the shuffle with the Web Animations API (client only, so no SSR mismatch).
  useEffect(() => {
    const stack = stackRef.current;
    if (!stack || reducedMotion) return;

    const cards = Array.from(stack.children) as HTMLElement[];
    const n = cards.length;
    // Landings are spread evenly between 40% and 82% of the cycle.
    const landGap = 0.42 / n;

    const animations = cards.map((card, k) => {
      const side = k % 2 === 0 ? -1 : 1; // even = left half, odd = right half
      const pileIndex = Math.floor(k / 2);
      const landStart = 0.4 + k * landGap;

      const stacked = `translate(0px, ${-k * stackStep}px) rotate(0deg)`;
      const split = `translate(${side * splitX}px, ${-pileIndex * 2 * unit}px) rotate(${side * 12}deg)`;
      const lift = `translate(${side * splitX * 0.35}px, ${-(8 + k) * unit}px) rotate(${side * 5}deg)`;

      return card.animate(
        [
          { offset: 0, transform: stacked },
          { offset: 0.1, transform: stacked, easing: "cubic-bezier(.3,0,.2,1)" },
          { offset: 0.3, transform: split },
          { offset: landStart, transform: split, easing: "ease-out" },
          { offset: landStart + landGap / 2, transform: lift, easing: "ease-in" },
          { offset: landStart + landGap, transform: stacked },
          { offset: 1, transform: stacked },
        ],
        { duration, iterations: Infinity },
      );
    });

    return () => animations.forEach((animation) => animation.cancel());
  }, [count, duration, reducedMotion, splitX, stackStep, unit]);

  // Swap the flavor text once per shuffle.
  useEffect(() => {
    if (!withText || reducedMotion || messages.length < 2) return;
    const id = window.setInterval(
      () => setMessageIndex((i) => (i + 1) % messages.length),
      duration,
    );
    return () => window.clearInterval(id);
  }, [withText, reducedMotion, messages.length, duration]);

  const message = messages.length > 0 ? messages[messageIndex % messages.length] : "";

  return (
    <div
      role="status"
      aria-live="polite"
      className={className}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: Math.max(8, Math.round(cardWidth * 0.4)),
        ...style,
      }}
    >
      <span style={visuallyHidden}>{label}</span>

      <div
        aria-hidden="true"
        style={{ position: "relative", width: stageWidth, height: stageHeight, flexShrink: 0 }}
      >
        <div
          ref={stackRef}
          style={{
            position: "absolute",
            left: "50%",
            bottom: 0,
            width: cardWidth,
            height: cardHeight,
            marginLeft: -cardWidth / 2,
          }}
        >
          {Array.from({ length: count }, (_, k) => (
            <div
              key={k}
              style={{
                position: "absolute",
                inset: 0,
                zIndex: k,
                boxSizing: "border-box",
                borderRadius: radius,
                border: `${borderWidth}px solid ${accentColor}`,
                background: cardColor,
                transform: `translate(0px, ${-k * stackStep}px)`,
                willChange: "transform",
              }}
            >
              <div
                style={{
                  position: "absolute",
                  inset: innerInset,
                  borderRadius: Math.max(1, radius - 2),
                  border: `1px solid ${accentColor}`,
                  opacity: 0.45,
                }}
              />
            </div>
          ))}
        </div>
      </div>

      {withText && message ? (
        // Hidden from screen readers so they hear "Loading" once, not every swap.
        <span aria-hidden="true" style={{ fontSize: "0.875rem", opacity: 0.75 }}>
          {message}
        </span>
      ) : null}
    </div>
  );
}

export default RiffleLoader;
