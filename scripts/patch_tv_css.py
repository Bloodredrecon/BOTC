"""Replace TV stylesheet section with bloody red-moon gothic chrome."""
from pathlib import Path

CSS_PATH = Path(r"C:\Users\danie\BOTC\web\src\styles.css")

NEW_TV = r"""
/* ——— TV (bloody red-moon gothic) ——— */
.tv {
  --tv-gold: #c9a24a;
  --tv-gold-bright: #e4c77a;
  --tv-blood: #c41e24;
  --tv-blood-glow: rgba(196, 30, 36, 0.55);
  --tv-ink-paper: #2a1a12;
  --tv-paper-muted: #5a4030;
  position: relative;
  isolation: isolate;
  min-height: 100vh;
  min-height: 100dvh;
  padding: clamp(1rem, 2.2vw, 2.75rem) clamp(1.1rem, 3vw, 3.25rem) clamp(1.25rem, 2.5vw, 2.5rem);
  display: grid;
  grid-template-rows: auto auto 1fr auto;
  grid-template-columns: 1fr;
  gap: clamp(0.6rem, 1.4vw, 1.35rem);
  overflow: hidden;
  color: var(--bone);
}

.tv-atmosphere {
  position: fixed;
  inset: 0;
  z-index: -1;
  pointer-events: none;
  background: #050203;
  overflow: hidden;
}

.tv-atmosphere-plate {
  position: absolute;
  inset: 0;
  display: block;
}

.tv-atmosphere-plate img {
  width: 100%;
  height: 100%;
  object-fit: cover;
  object-position: center 35%;
  display: block;
  transform: scale(1.02);
}

.tv-atmosphere-tint {
  position: absolute;
  inset: 0;
  transition: background 1.1s ease, opacity 1.1s ease;
  background: rgba(0, 0, 0, 0.18);
}

.tv-atmosphere-vignette {
  position: absolute;
  inset: 0;
  background:
    radial-gradient(ellipse 75% 65% at 50% 40%, transparent 35%, rgba(0, 0, 0, 0.55) 100%),
    linear-gradient(180deg, rgba(0, 0, 0, 0.25) 0%, transparent 22%, transparent 55%, rgba(0, 0, 0, 0.55) 100%);
}

.tv-atmosphere-mist {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
  height: 28%;
  background: linear-gradient(180deg, transparent, rgba(20, 12, 14, 0.45));
  opacity: 0.85;
}

/* Phase mood = CSS tint on same 4K plate */
.tv.phase-lobby .tv-atmosphere-tint {
  background: rgba(8, 4, 5, 0.28);
}
.tv.phase-night .tv-atmosphere-tint,
.tv.phase-firstNight .tv-atmosphere-tint {
  background: rgba(4, 6, 14, 0.22);
}
.tv.phase-dawn .tv-atmosphere-tint {
  background: linear-gradient(180deg, rgba(180, 90, 40, 0.12), rgba(40, 8, 10, 0.2));
}
.tv.phase-day .tv-atmosphere-tint {
  background: rgba(40, 28, 18, 0.12);
}
.tv.phase-nomination .tv-atmosphere-tint,
.tv.phase-vote .tv-atmosphere-tint,
.tv.phase-execution .tv-atmosphere-tint {
  background: rgba(60, 4, 8, 0.28);
}
.tv.phase-ended .tv-atmosphere-tint {
  background: rgba(30, 18, 8, 0.22);
}

/* Top-left dripping brand */
.tv-brand {
  position: relative;
  z-index: 2;
  margin: 0;
  justify-self: start;
  align-self: start;
  max-width: min(28rem, 42vw);
  line-height: 0.92;
  filter: drop-shadow(0 2px 0 #000) drop-shadow(0 0 18px var(--tv-blood-glow));
}

.tv-brand-blood,
.tv-brand-on,
.tv-brand-tower {
  display: block;
  font-family: var(--font-brand);
  font-weight: 900;
  color: #f2ebe0;
  text-transform: uppercase;
}

.tv-brand-blood {
  font-size: clamp(1.55rem, 3.6vw, 3.35rem);
  letter-spacing: 0.04em;
  background: linear-gradient(180deg, #fff6ea 20%, #e8dcc4 55%, #8b1518 100%);
  -webkit-background-clip: text;
  background-clip: text;
  color: transparent;
  position: relative;
}

.tv-brand-blood::after {
  content: "";
  position: absolute;
  left: 0.15em;
  bottom: -0.35em;
  width: 0.18em;
  height: 0.55em;
  background: linear-gradient(180deg, #a0181c, #5a080a);
  border-radius: 0 0 40% 40%;
  box-shadow:
    0.55em 0.1em 0 -0.04em #7a1014,
    1.15em -0.05em 0 -0.02em #9a181c,
    1.85em 0.15em 0 -0.05em #6a0c10;
  opacity: 0.9;
  pointer-events: none;
}

.tv-brand-on {
  font-family: var(--font-display);
  font-size: clamp(0.55rem, 1.1vw, 0.85rem);
  letter-spacing: 0.42em;
  margin: 0.15rem 0 0.1rem;
  color: rgba(232, 220, 196, 0.72);
}

.tv-brand-tower {
  font-size: clamp(1.15rem, 2.6vw, 2.35rem);
  letter-spacing: 0.06em;
}

/* Center hero */
.tv-hero-center {
  position: relative;
  z-index: 2;
  text-align: center;
  justify-self: center;
  width: min(52rem, 92vw);
  padding: 0.25rem 0.5rem 0.5rem;
  margin-top: clamp(-3.5rem, -4vw, -1rem);
}

.tv-hero-center.compact {
  margin-top: 0;
  padding-bottom: 0;
}

.tv-phase-line {
  margin: 0;
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(1.55rem, 4.2vw, 3.4rem);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tv-blood);
  text-shadow:
    0 0 28px var(--tv-blood-glow),
    0 2px 0 #000;
}

.tv-meta {
  margin: 0.35rem 0 0;
  font-family: var(--font-body);
  font-style: italic;
  font-size: clamp(0.95rem, 1.6vw, 1.35rem);
  color: rgba(243, 230, 208, 0.88);
  text-shadow: 0 1px 3px #000;
}

.tv-meta-sep {
  margin: 0 0.35em;
  opacity: 0.7;
}

.tv-ornament-rule {
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  margin: 1rem auto 0.65rem;
  max-width: 28rem;
}

.tv-ornament-rule span {
  flex: 1;
  height: 1px;
  background: linear-gradient(90deg, transparent, rgba(196, 30, 36, 0.75), transparent);
}

.tv-ornament-rule i {
  width: 0.55rem;
  height: 0.55rem;
  border: 1px solid rgba(196, 30, 36, 0.85);
  border-radius: 50%;
  box-shadow: 0 0 10px var(--tv-blood-glow);
  display: block;
}

.tv-dawn-banner {
  margin-top: 0.35rem;
}

.tv-dawn-kicker {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(0.72rem, 1.2vw, 0.95rem);
  letter-spacing: 0.38em;
  text-transform: uppercase;
  color: rgba(243, 230, 208, 0.82);
}

.tv-dawn-empty {
  margin: 0.55rem 0 0;
  font-family: var(--font-omen);
  font-size: clamp(1.5rem, 3.5vw, 2.6rem);
  font-style: italic;
  color: var(--ink-dim);
}

.tv-dawn-names {
  list-style: none;
  margin: 0.55rem 0 0;
  padding: 0;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.45rem;
}

.tv-dawn-names li {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(2.1rem, 5.8vw, 4.2rem);
  color: #fff;
  letter-spacing: 0.02em;
  text-shadow: 0 0 24px var(--tv-blood-glow), 0 2px 0 #000;
  opacity: 0;
  transform: translateY(0.35rem);
  animation: tv-dawn-ink 1s ease forwards;
}

@keyframes tv-dawn-ink {
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tv-stage {
  position: relative;
  z-index: 2;
  text-align: center;
  padding: 0.35rem 0 0.75rem;
}

.tv-stage-title {
  margin: 0 0 0.75rem;
  font-size: clamp(0.85rem, 1.5vw, 1.05rem);
  letter-spacing: 0.28em;
  text-transform: uppercase;
  color: var(--brass-dim);
  font-family: var(--font-display);
}

.tv-winner {
  font-size: clamp(1.8rem, 4vw, 2.6rem);
  margin: 0.5rem 0 1.25rem;
}

.tv-execution-name {
  font-family: var(--font-display);
  font-size: clamp(2.2rem, 6vw, 3.5rem);
  margin: 0;
  color: var(--blood-bright);
}

.tv-timer-stage .timer-big {
  margin-top: 0.25rem;
}

.tv-reveal-roster {
  max-width: 64rem;
  margin: 0 auto;
}

/* Vote ring */
.tv-vote-ring {
  max-width: 48rem;
  margin: 0 auto;
}

.tv-vote-kicker {
  margin: 0 0 0.35rem;
  font-family: var(--font-display);
  font-size: 0.72rem;
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: var(--muted);
}

.tv-vote-headline {
  margin: 0;
  line-height: 1.05;
}

.tv-vote-nominee {
  font-family: var(--font-display);
  font-size: clamp(2rem, 5.5vw, 3.4rem);
  font-weight: 700;
  color: var(--blood-bright);
  letter-spacing: 0.04em;
}

.tv-vote-sub {
  margin: 0.45rem 0 0;
  font-family: var(--font-body);
  font-size: clamp(1.1rem, 2.2vw, 1.35rem);
  color: var(--ink-dim);
  font-style: italic;
}

.tv-vote-nominator {
  font-family: var(--font-display);
  font-style: normal;
  font-weight: 700;
  color: var(--bone);
}

.tv-vote-tally-row {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.25rem;
  margin: 1rem 0 0.5rem;
}

.tv-vote-tally {
  font-family: var(--font-brand);
  font-size: clamp(2rem, 5vw, 3rem);
  line-height: 1;
  color: var(--bone);
}

.tv-vote-tally .sep {
  margin: 0 0.12em;
  color: var(--muted);
  font-size: 0.7em;
}

.tv-vote-tally .need {
  color: var(--brass-dim);
  font-size: 0.72em;
}

.tv-vote-tally.over {
  color: var(--blood-bright);
}

.tv-vote-threshold-label {
  font-family: var(--font-display);
  font-size: 0.7rem;
  letter-spacing: 0.22em;
  text-transform: uppercase;
  color: var(--muted);
}

.tv-vote-ring.majority-met .tv-vote-threshold-label {
  color: var(--blood-bright);
}

.tv-vote-ring.majority-beat .tv-vote-tally {
  animation: tv-majority-flash 0.85s ease;
}

@keyframes tv-majority-flash {
  0%,
  100% {
    opacity: 1;
  }
  35% {
    opacity: 0.35;
  }
  55% {
    opacity: 1;
  }
}

.tv-vote-stage {
  display: flex;
  justify-content: center;
  padding: 0.75rem 0 0.5rem;
}

.tv-vote-circle {
  --ring-r: min(36vw, 12.5rem);
  position: relative;
  width: calc(var(--ring-r) * 2 + 6.5rem);
  height: calc(var(--ring-r) * 2 + 6.5rem);
  max-width: 100%;
}

.tv-vote-ring-line {
  position: absolute;
  left: 50%;
  top: 50%;
  width: calc(var(--ring-r) * 2);
  height: calc(var(--ring-r) * 2);
  margin: calc(var(--ring-r) * -1) 0 0 calc(var(--ring-r) * -1);
  border: 1px solid rgba(196, 163, 90, 0.28);
  border-radius: 50%;
  pointer-events: none;
}

.tv-vote-seat {
  --a: 0deg;
  position: absolute;
  left: 50%;
  top: 50%;
  width: 5.25rem;
  margin-left: -2.625rem;
  margin-top: -1.25rem;
  transform: rotate(var(--a)) translate(var(--ring-r)) rotate(calc(-1 * var(--a)));
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.3rem;
  transition: opacity 0.3s ease;
}

.tv-vote-seat.dead {
  opacity: 0.32;
}

.tv-vote-token {
  width: 0.7rem;
  height: 0.7rem;
  border-radius: 50%;
  border: 1px solid rgba(196, 163, 90, 0.4);
  background: transparent;
  transition: background 0.3s ease, border-color 0.3s ease;
}

.tv-vote-seat.voted .tv-vote-token {
  background: var(--brass-dim);
  border-color: var(--brass);
}

.tv-vote-seat.nominee .tv-vote-token {
  border-color: var(--blood-bright);
  background: var(--blood);
}

.tv-vote-seat.nominee .tv-vote-seat-name {
  color: var(--blood-bright);
}

.tv-vote-seat-name {
  font-family: var(--font-display);
  font-size: clamp(0.7rem, 1.4vw, 0.85rem);
  font-weight: 600;
  color: var(--ink-dim);
  text-align: center;
  max-width: 6rem;
  line-height: 1.15;
  letter-spacing: 0.02em;
}

.tv-vote-seat.voted .tv-vote-seat-name {
  color: var(--bone);
}

/* Bottom: THE TOWN + TOWN LEDGER */
.tv-below {
  display: grid;
  grid-template-columns: minmax(0, 1.35fr) minmax(16rem, 0.9fr);
  gap: clamp(1rem, 2.5vw, 2rem);
  align-items: end;
  position: relative;
  z-index: 2;
  margin-top: auto;
}

@media (max-width: 900px) {
  .tv-below {
    grid-template-columns: 1fr;
  }

  .tv-brand {
    max-width: 70vw;
  }

  .tv-hero-center {
    margin-top: 0;
  }

  .tv-vote-circle {
    --ring-r: min(32vw, 9.5rem);
  }
}

.tv-town {
  position: relative;
  padding: clamp(0.75rem, 1.4vw, 1.15rem);
  border: 1px solid rgba(196, 30, 36, 0.55);
  background:
    linear-gradient(165deg, rgba(18, 8, 10, 0.72), rgba(8, 3, 4, 0.78));
  box-shadow:
    0 0 0 1px rgba(0, 0, 0, 0.55) inset,
    0 18px 40px rgba(0, 0, 0, 0.45);
}

.tv-town h2 {
  margin: 0 0 clamp(0.65rem, 1.2vw, 1rem);
  display: flex;
  align-items: center;
  justify-content: center;
  gap: 0.65rem;
  font-family: var(--font-display);
  font-size: clamp(0.78rem, 1.3vw, 1rem);
  letter-spacing: 0.32em;
  text-transform: uppercase;
  color: #f0e6d4;
  text-shadow: 0 1px 2px #000;
}

.tv-town-flourish {
  color: var(--tv-gold);
  opacity: 0.75;
  font-size: 0.85em;
}

.tv-town-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(clamp(8.5rem, 12vw, 11.5rem), 1fr));
  gap: clamp(0.45rem, 1vw, 0.75rem);
}

.tv-seat-card {
  position: relative;
  padding: clamp(0.55rem, 1vw, 0.8rem) clamp(0.5rem, 0.9vw, 0.7rem);
  border: 1px solid rgba(120, 100, 80, 0.35);
  background: linear-gradient(180deg, rgba(40, 22, 20, 0.55), rgba(10, 5, 6, 0.7));
  min-height: clamp(4.5rem, 8vh, 6.25rem);
  display: flex;
  flex-direction: column;
  gap: 0.2rem;
}

.tv-seat-card.alive {
  border-color: rgba(201, 162, 74, 0.85);
  box-shadow:
    0 0 0 1px rgba(201, 162, 74, 0.25),
    0 0 18px rgba(201, 162, 74, 0.12);
}

.tv-seat-card.dead {
  opacity: 0.55;
  filter: grayscale(0.55) brightness(0.78);
  border-color: rgba(90, 90, 90, 0.45);
}

.tv-seat-top {
  display: flex;
  align-items: center;
  gap: 0.4rem;
}

.tv-seat-icon {
  width: clamp(1rem, 1.5vw, 1.25rem);
  height: clamp(1rem, 1.5vw, 1.25rem);
  flex: 0 0 auto;
}

.tv-seat-card.alive .tv-seat-icon {
  color: var(--tv-gold-bright);
}

.tv-seat-card.dead .tv-seat-icon {
  color: rgba(180, 180, 180, 0.75);
}

.tv-seat-num {
  font-family: var(--font-display);
  font-size: clamp(0.58rem, 0.95vw, 0.72rem);
  letter-spacing: 0.16em;
  text-transform: uppercase;
  color: rgba(196, 180, 150, 0.7);
}

.tv-seat-card.alive .tv-seat-num {
  color: rgba(228, 199, 122, 0.85);
}

.tv-seat-name {
  font-family: var(--font-display);
  font-weight: 700;
  font-size: clamp(1rem, 1.8vw, 1.35rem);
  color: var(--bone);
  line-height: 1.15;
  margin-top: 0.15rem;
}

.tv-seat-status {
  font-family: var(--font-body);
  font-size: clamp(0.75rem, 1.1vw, 0.92rem);
  margin-top: auto;
}

.tv-seat-card.alive .tv-seat-status {
  color: var(--tv-gold);
}

.tv-seat-card.dead .tv-seat-status {
  color: rgba(160, 160, 160, 0.85);
}

/* Town ledger — real parchment raster */
.tv-ledger {
  position: relative;
  z-index: 2;
  padding: 0;
  max-width: 100%;
}

.tv-ledger-raven {
  position: absolute;
  top: -1.6rem;
  right: -0.35rem;
  width: clamp(3.5rem, 7vw, 5.5rem);
  height: auto;
  z-index: 3;
  filter: drop-shadow(0 6px 10px rgba(0, 0, 0, 0.65));
  pointer-events: none;
}

.tv-ledger-sheet {
  position: relative;
  min-height: clamp(14rem, 32vh, 22rem);
  padding: clamp(1.1rem, 2vw, 1.6rem) clamp(1rem, 1.8vw, 1.45rem) clamp(1.25rem, 2vw, 1.75rem);
  background-color: #c4a878;
  background-image: url("/tv/parchment.png");
  background-size: cover;
  background-position: center;
  background-repeat: no-repeat;
  box-shadow:
    0 16px 40px rgba(0, 0, 0, 0.55),
    0 0 0 1px rgba(40, 20, 10, 0.35);
  color: var(--tv-ink-paper);
  clip-path: polygon(
    1% 0.5%,
    99% 0%,
    100% 2%,
    99.2% 98.5%,
    97% 100%,
    2% 99.4%,
    0% 97%,
    0.6% 2%
  );
}

.tv-ledger-head {
  display: flex;
  align-items: baseline;
  justify-content: space-between;
  gap: 0.75rem;
  border-bottom: 1px solid rgba(42, 26, 18, 0.28);
  padding-bottom: 0.45rem;
  margin-bottom: 0.55rem;
}

.tv-ledger-head h2 {
  margin: 0;
  font-family: var(--font-display);
  font-size: clamp(1rem, 1.8vw, 1.35rem);
  letter-spacing: 0.14em;
  color: var(--tv-ink-paper);
}

.tv-ledger-phase-badge {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  font-family: var(--font-display);
  font-size: clamp(0.62rem, 1vw, 0.78rem);
  letter-spacing: 0.14em;
  text-transform: uppercase;
  color: var(--tv-paper-muted);
  white-space: nowrap;
}

.tv-ledger-phase-icon {
  font-style: normal;
  font-size: 1.1em;
}

.tv-ledger-lines {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: min(36vh, 18rem);
  overflow: auto;
}

.tv-ledger-line {
  display: grid;
  grid-template-columns: 1fr auto;
  gap: 0.5rem 0.75rem;
  align-items: start;
  padding: 0.4rem 0;
  border-bottom: 1px solid rgba(42, 26, 18, 0.12);
  opacity: calc(1 - var(--fade, 0));
}

.tv-ledger-line:last-child {
  border-bottom: none;
}

.tv-ledger-line p {
  margin: 0;
  font-family: var(--font-body);
  font-size: clamp(0.95rem, 1.35vw, 1.15rem);
  line-height: 1.3;
  color: var(--tv-paper-muted);
  font-style: italic;
}

.tv-ledger-line.fresh p,
.tv-ledger-line p.emph {
  color: var(--tv-ink-paper);
  font-style: normal;
  font-weight: 600;
}

.tv-ledger-line.death p.emph {
  font-weight: 700;
}

.tv-ledger-marker {
  font-family: var(--font-display);
  font-size: clamp(0.58rem, 0.9vw, 0.7rem);
  letter-spacing: 0.12em;
  text-transform: uppercase;
  color: var(--tv-paper-muted);
  white-space: nowrap;
  padding-top: 0.15rem;
}

.tv-ledger-line.empty p {
  font-style: italic;
}
"""

text = CSS_PATH.read_text(encoding="utf-8")
start = text.index("/* ——— TV ——— */")
end = text.index(".panel {")
CSS_PATH.write_text(text[:start] + NEW_TV.strip() + "\n\n" + text[end:], encoding="utf-8")
print("styles.css TV section replaced")
