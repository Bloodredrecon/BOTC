import type { CSSProperties } from "react";
import type { Phase, PublicState } from "../../types";
import { plateKeyForPhase, plateUrl } from "./assets";

/** Rising embers at night / dusk; each has its own lane, speed and delay in tv.css. */
const EMBERS = 12;
const MOTES = 14;
const ASH = 12;
const POLLEN = 12;
const RAIN = 24;
const WISPS = 6;
const SHAFTS = 2;

type FxVars = CSSProperties & Record<`--${string}`, string>;

function dots(n: number, vars: (i: number) => Record<string, string>): FxVars[] {
  return Array.from({ length: n }, (_, i) => vars(i) as FxVars);
}

const EMBER_DOTS = dots(EMBERS, (i) => {
  const x = 6 + i * 8.1;
  const d = 11 + (i % 7) * 1.2;
  const delay = -((i * 3 + 2) % 17);
  const sway = ((i % 5) - 2) * 1.2;
  return { "--x": `${x}%`, "--d": `${d}s`, "--delay": `${delay}s`, "--sway": `${sway}vw` };
});

const MOTE_DOTS = dots(MOTES, (i) => {
  const x = 4 + i * 6.8 + (i % 3) * 1.1;
  const y = 18 + ((i * 13) % 55);
  const d = 22 + (i % 9) * 2.4;
  const delay = -((i * 5) % 29);
  const sway = ((i % 4) - 1.5) * 2.2;
  return {
    "--x": `${x}%`,
    "--y": `${y}%`,
    "--d": `${d}s`,
    "--delay": `${delay}s`,
    "--sway": `${sway}vw`,
  };
});

const ASH_DOTS = dots(ASH, (i) => {
  const x = 5 + i * 7.6;
  const d = 16 + (i % 6) * 2.1;
  const delay = -((i * 4 + 1) % 21);
  const sway = ((i % 5) - 2) * 1.8;
  return { "--x": `${x}%`, "--d": `${d}s`, "--delay": `${delay}s`, "--sway": `${sway}vw` };
});

const POLLEN_DOTS = dots(POLLEN, (i) => {
  const x = 8 + i * 7.2;
  const d = 18 + (i % 5) * 2.6;
  const delay = -((i * 4) % 19);
  const sway = ((i % 4) - 1.5) * 2.4;
  return { "--x": `${x}%`, "--d": `${d}s`, "--delay": `${delay}s`, "--sway": `${sway}vw` };
});

const RAIN_DOTS = dots(RAIN, (i) => {
  const x = ((i + 0.4) / RAIN) * 100 + ((i % 3) - 1) * 1.4;
  const d = 1.15 + (i % 5) * 0.22;
  const delay = -((i * 0.37) % 2.4);
    const len = 9 + (i % 4) * 3;
  return {
    "--x": `${Math.max(1, Math.min(99, x))}%`,
    "--d": `${d}s`,
    "--delay": `${delay}s`,
    "--len": `${len}vh`,
  };
});

const WISP_DOTS = dots(WISPS, (i) => {
  const x = -10 + i * 18;
  const y = 8 + (i % 3) * 10;
  const w = 28 + (i % 3) * 10;
  const h = 16 + (i % 2) * 8;
  const d = 48 + i * 11;
  const delay = -(i * 9);
  return {
    "--x": `${x}%`,
    "--y": `${y}%`,
    "--w": `${w}vw`,
    "--h": `${h}vh`,
    "--d": `${d}s`,
    "--delay": `${delay}s`,
  };
});

const RAVEN_DOTS: FxVars[] = [
  { "--y": "9%", "--d": "52s", "--delay": "-14s", "--dip": "3vh", "--scale": "1" },
  { "--y": "16%", "--d": "68s", "--delay": "-40s", "--dip": "-2vh", "--scale": "0.78" },
  { "--y": "22%", "--d": "86s", "--delay": "-22s", "--dip": "2.4vh", "--scale": "0.62" },
];

function Particles({ className, items }: { className: string; items: FxVars[] }) {
  return (
    <div className={className}>
      {items.map((style, i) => (
        <span key={i} style={style} />
      ))}
    </div>
  );
}

/** Full-bleed scene plate + grade layers (plates stay cover-fit behind the 16:9 stage). */
export function Atmosphere({
  phase,
  winner,
  dayNumber,
  rain,
  funeral,
}: {
  phase?: Phase;
  winner?: PublicState["winner"];
  dayNumber?: number;
  rain?: boolean;
  funeral?: boolean;
}) {
  const plateKey = plateKeyForPhase(phase, winner, dayNumber);
  const src = plateUrl(plateKey);
  const nightSky = phase === "night" || phase === "firstNight" || phase === "dusk";
  const evilEnd = phase === "ended" && winner === "evil";
  const goodEnd = phase === "ended" && winner === "good";
  const embersOn = nightSky || phase === "execution" || evilEnd;
  const motesOn = phase === "day" || phase === "lobby" || phase == null;
  return (
    <div className={`tv-atmosphere tv-plate-${plateKey}`} aria-hidden data-plate={plateKey}>
      <div className="tv-atmosphere-plate" style={{ backgroundImage: `url(${src})` }} />
      <div className="tv-atmosphere-tint" />
      {embersOn && <div className="tv-atmosphere-hearth" />}
      {phase === "dawn" && (
        <div className="tv-atmosphere-shafts">
          {Array.from({ length: SHAFTS }, (_, i) => (
            <span key={i} />
          ))}
        </div>
      )}
      {nightSky && <Particles className="tv-atmosphere-ravens" items={RAVEN_DOTS} />}
      <div className="tv-atmosphere-vignette" />
      <div className="tv-atmosphere-mist" />
      <div className="tv-atmosphere-fog" />
      <div className="tv-atmosphere-fog-high" />
      <div className="tv-atmosphere-fog-veil" />
      <Particles className="tv-atmosphere-wisps" items={WISP_DOTS} />
      {rain && (
        <>
          <div className="tv-atmosphere-rain-wash" />
          <Particles className="tv-atmosphere-rain" items={RAIN_DOTS} />
        </>
      )}
      {embersOn && <Particles className="tv-atmosphere-embers" items={EMBER_DOTS} />}
      {(phase === "execution" || funeral || evilEnd) && (
        <Particles className="tv-atmosphere-ash" items={ASH_DOTS} />
      )}
      {motesOn && <Particles className="tv-atmosphere-motes" items={MOTE_DOTS} />}
      {goodEnd && <Particles className="tv-atmosphere-pollen" items={POLLEN_DOTS} />}
      <div className="tv-atmosphere-dawn-ink" />
    </div>
  );
}
