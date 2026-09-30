import { useLayoutEffect, useRef, type CSSProperties, type ElementType, type ReactNode } from "react";

/**
 * Live text that must never clip: measures itself and sets `--fit` (the element's
 * font-size must be `calc(<base> * var(--fit, 1))`). Shrinks on one line first; long
 * multi-word text may wrap to `lines` at word boundaries only — never mid-word.
 */
export function FitText({
  as: Tag = "span",
  className,
  style,
  children,
  min = 0.5,
  lines = 2,
  wrapBelow = 0.74,
}: {
  as?: ElementType;
  className?: string;
  style?: CSSProperties;
  children: ReactNode;
  min?: number;
  lines?: number;
  wrapBelow?: number;
}) {
  const ref = useRef<HTMLElement>(null);
  const text = typeof children === "string" ? children : String(children ?? "");

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;

    const fit = () => {
      el.style.setProperty("--fit", "1");
      el.dataset.wrap = "0";
      const width = el.clientWidth;
      if (!width || el.scrollWidth <= width + 0.5) return;

      const oneLine = width / el.scrollWidth;
      const canWrap = lines > 1 && /\s/.test(el.textContent?.trim() ?? "");
      if (oneLine >= wrapBelow || !canWrap) {
        el.style.setProperty("--fit", String(Math.max(min, Math.floor(oneLine * 100) / 100)));
        return;
      }

      el.dataset.wrap = "1";
      for (let f = 1; f >= min - 1e-6; f -= 0.03) {
        el.style.setProperty("--fit", f.toFixed(2));
        const lh = parseFloat(getComputedStyle(el).lineHeight) || 1;
        const rows = Math.round(el.scrollHeight / lh);
        if (el.scrollWidth <= el.clientWidth + 0.5 && rows <= lines) return;
      }
      el.style.setProperty("--fit", String(min));
    };

    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };

    fit();
    void document.fonts?.ready.then(schedule);
    const ro = new ResizeObserver(schedule);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [text, min, lines, wrapBelow]);

  return (
    <Tag ref={ref} className={`tv-fit ${className ?? ""}`} style={style}>
      {children}
    </Tag>
  );
}

/**
 * Box whose height is set by layout (e.g. a shrinking flex item): lowers `--fit` on
 * itself until its content no longer overflows vertically.
 */
export function FitBox({
  as: Tag = "div",
  className,
  children,
  min = 0.45,
  watch,
  ...rest
}: {
  as?: ElementType;
  className?: string;
  children: ReactNode;
  min?: number;
  watch: string;
} & Record<string, unknown>) {
  const ref = useRef<HTMLElement>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    let raf = 0;
    const fit = () => {
      for (let f = 1; f >= min - 1e-6; f -= 0.04) {
        el.style.setProperty("--fit", f.toFixed(2));
        if (el.scrollHeight <= el.clientHeight + 1) return;
      }
      el.style.setProperty("--fit", String(min));
    };
    const schedule = () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(fit);
    };
    fit();
    void document.fonts?.ready.then(schedule);
    const ro = new ResizeObserver(schedule);
    if (el.parentElement) ro.observe(el.parentElement);
    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [watch, min]);

  return (
    <Tag ref={ref} className={className} {...rest}>
      {children}
    </Tag>
  );
}
