import type { ReactNode } from "react";

/** Typographic wordmark (self-hosted Cinzel Decorative). */
export function TvBrandLogo() {
  return (
    <div className="tv-brand" aria-hidden="true">
      <div className="tv-brand-stack">
        <span className="tv-brand-blood">Blood</span>
        <span className="tv-brand-on">
          <i className="tv-brand-rule" />
          <em>on the</em>
          <i className="tv-brand-rule" />
        </span>
        <span className="tv-brand-clock">Clocktower</span>
      </div>
      <svg className="tv-brand-drips" viewBox="0 0 320 36" preserveAspectRatio="none" aria-hidden>
        <path
          fill="currentColor"
          d="M18 0c1 6 2 10 1 16-1 5-3 9-2 14 4-6 5-12 4-18 2 4 3 9 2 14M52 0c2 7 1 12 2 18 0 5-1 9 1 14 3-8 2-14 1-20 3 5 4 11 3 18M88 0c1 5 3 11 2 17 0 6-2 10 0 15 4-7 5-13 3-20 2 4 3 10 2 16M124 0c2 8 1 13 0 19 2 5 4 9 2 14 5-9 3-15 2-22 2 5 3 12 2 18M160 0c1 6 2 12 1 18-1 5 1 10 0 15 4-7 4-14 3-20 2 5 3 11 2 17M196 0c2 7 1 13 2 19 0 4-2 9 1 13 3-6 4-12 2-18 3 5 4 12 3 18M232 0c1 5 2 11 1 17 1 6-1 10 1 15 4-8 4-13 3-20 2 4 3 11 2 16M268 0c2 8 1 12 0 18 2 5 3 10 1 14 5-8 4-14 3-21 2 5 3 12 2 18M302 0c1 6 2 11 1 17 0 5-1 9 1 14 3-7 4-13 2-19 2 4 3 10 2 16"
        />
      </svg>
    </div>
  );
}

/** Oak + brass plaque (9-slice of plaque-oak.png) that grows with its content. */
export function OakPlaque({ className = "", children }: { className?: string; children: ReactNode }) {
  return <div className={`tv-oak ${className}`}>{children}</div>;
}

/** Brass fleur ornament used either side of spaced-cap labels. */
export function Fleur({ flip = false }: { flip?: boolean }) {
  return (
    <svg className={`tv-fleur ${flip ? "flip" : ""}`} viewBox="0 0 40 20" aria-hidden>
      <path
        fill="currentColor"
        d="M20 2c1.6 2.6 1.6 5 0 8-1.6-3-1.6-5.4 0-8zm0 16c-1.6-2.6-1.6-5 0-8 1.6 3 1.6 5.4 0 8zM12 10c2.6-1.6 5-1.6 8 0-3 1.6-5.4 1.6-8 0zm16 0c-2.6 1.6-5 1.6-8 0 3-1.6 5.4-1.6 8 0zM0 9.4h9v1.2H0zm31 0h9v1.2h-9z"
      />
    </svg>
  );
}

/** Small spaced serif caps label (E–C–B “THE NIGHT CLAIMED”). */
export function TvLabel({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`tv-label ${className}`}>{children}</p>;
}

/** Huge condensed phase word with CSS distress + blood wear (no baked art). */
export function PhaseWord({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`tv-phase-word ${className}`}>
      <span className="tv-phase-word-ink">{children}</span>
    </p>
  );
}

/** Handwritten script meta line. */
export function TvScript({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <p className={`tv-script ${className}`}>{children}</p>;
}

export function BloodDrop() {
  return (
    <svg className="tv-blood-drop" viewBox="0 0 12 16" aria-hidden>
      <path fill="currentColor" d="M6 0C4 4 1 7 1 10.5A5 5 0 0 0 11 10.5C11 7 8 4 6 0z" />
    </svg>
  );
}

export function Dot() {
  return (
    <span className="tv-dot" aria-hidden>
      •
    </span>
  );
}
