import type { Phase, PublicState } from "../../types";
import { plateKeyForPhase, plateUrl } from "./assets";

/** Full-bleed scene plate + grade layers (plates stay cover-fit behind the 16:9 stage). */
export function Atmosphere({
  phase,
  winner,
  dayNumber,
}: {
  phase?: Phase;
  winner?: PublicState["winner"];
  dayNumber?: number;
}) {
  const plateKey = plateKeyForPhase(phase, winner, dayNumber);
  const src = plateUrl(plateKey);
  return (
    <div className={`tv-atmosphere tv-plate-${plateKey}`} aria-hidden data-plate={plateKey}>
      <div className="tv-atmosphere-plate" style={{ backgroundImage: `url(${src})` }} />
      <div className="tv-atmosphere-tint" />
      <div className="tv-atmosphere-vignette" />
      <div className="tv-atmosphere-mist" />
      <div className="tv-atmosphere-dawn-ink" />
    </div>
  );
}
