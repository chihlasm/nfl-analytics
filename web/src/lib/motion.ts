import { useEffect, useState, useSyncExternalStore } from "react";

const query = "(prefers-reduced-motion: reduce)";

/** True when the visitor asked their device for less motion. */
export function useReducedMotion(): boolean {
  return useSyncExternalStore(
    (onChange) => {
      const mq = window.matchMedia(query);
      mq.addEventListener("change", onChange);
      return () => mq.removeEventListener("change", onChange);
    },
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/**
 * A 0 → 1 progress value that eases out over `ms`, restarting whenever `key`
 * changes (e.g. a new player or season). Jumps straight to 1 for reduced motion.
 */
export function useCountUp(key: unknown, ms = 1400): number {
  const reduced = useReducedMotion();
  const [t, setT] = useState(reduced ? 1 : 0);
  useEffect(() => {
    if (reduced) {
      setT(1);
      return;
    }
    setT(0);
    let raf = 0;
    const start = performance.now();
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / ms);
      setT(1 - (1 - p) ** 3);
      if (p < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [key, ms, reduced]);
  return t;
}

/** Width of an element in CSS pixels, kept current as it resizes. */
export function useWidth<T extends HTMLElement>(): [(el: T | null) => void, number] {
  const [el, setEl] = useState<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    if (!el) return;
    const observer = new ResizeObserver(([entry]) => setWidth(Math.floor(entry?.contentRect.width ?? 0)));
    observer.observe(el);
    return () => observer.disconnect();
  }, [el]);
  return [setEl, width];
}
