import type { Player, StorytellerState, Team } from "../../types";

/** Reminder tokens shown on the circle; the full list is in the editor below. */
const MAX_TOKENS = 3;

function shortName(name: string) {
  return name.length > 12 ? `${name.slice(0, 11)}…` : name;
}

/**
 * The town as a grimoire: seats around a circle (seat 1 at the top, clockwise), each with its
 * character, alive/dead, ghost vote and reminder tokens. Tap a seat to edit it below.
 */
export function GrimoireCircle({
  state,
  selectedId,
  onSelect,
}: {
  state: StorytellerState;
  selectedId: string | null;
  onSelect: (id: string) => void;
}) {
  const seated = state.players.filter((p) => !p.leftGame).sort((a, b) => a.seat - b.seat);
  const n = seated.length;
  const charOf = (id: string | null) =>
    state.characters.find((c) => c.id === id) ?? state.travellers.find((c) => c.id === id);
  const demon = seated.find((p) => charOf(p.characterId)?.team === "demon");
  const bluffs = (demon?.bluffs ?? []).map((id) => charOf(id)?.name ?? id);
  const herring = seated.find((p) => p.reminders.includes("Red herring"));
  const alive = seated.filter((p) => p.alive).length;
  // Fewer seats get bigger tokens. Big tables use a taller ellipse: phones have height to spare.
  const size = n <= 8 ? 21 : n <= 10 ? 18 : n <= 12 ? 15 : 13;
  const aspect = n > 10 ? 0.75 : 1;
  const rx = 50 - size / 2 - 2;
  const ry = 50 - (size * aspect) / 2 - 3;

  return (
    <div className="grim-circle-wrap">
      <div
        className={`grim-circle ${aspect < 1 ? "tall" : ""}`}
        style={{ ["--token" as string]: `${size}%`, aspectRatio: String(aspect) }}
      >
        <div className="grim-center">
          <div className="grim-center-title">
            {alive} of {n} alive
          </div>
          {bluffs.length > 0 && (
            <div>
              <span className="muted">Bluffs</span> {bluffs.join(", ")}
            </div>
          )}
          {herring && (
            <div>
              <span className="muted">Red herring</span> {herring.name}
            </div>
          )}
        </div>
        {seated.map((p, i) => (
          <Seat
            key={p.id}
            player={p}
            angle={(i / n) * 2 * Math.PI}
            rx={rx}
            ry={ry}
            team={charOf(p.characterId)?.team ?? null}
            charName={charOf(p.characterId)?.name ?? null}
            thinksName={p.characterId === "drunk" ? (charOf(p.thinksCharacterId)?.name ?? "?") : null}
            selected={p.id === selectedId}
            onSelect={() => onSelect(p.id)}
          />
        ))}
      </div>
    </div>
  );
}

const SHY = "\u00AD";
/** Where long names may wrap on small tokens; other words longer than 8 letters split in the middle. */
const BREAKS: Record<string, string> = {
  Washerwoman: `Washer${SHY}woman`,
  Investigator: `Investi${SHY}gator`,
  Undertaker: `Under${SHY}taker`,
  Ravenkeeper: `Raven${SHY}keeper`,
  Librarian: `Libra${SHY}rian`,
};

function hyphenate(name: string) {
  return name
    .split(" ")
    .map((w) => BREAKS[w] ?? (w.length > 8 ? `${w.slice(0, Math.ceil(w.length / 2))}${SHY}${w.slice(Math.ceil(w.length / 2))}` : w))
    .join(" ");
}

/** Longer words get a smaller font; measured on the pieces between soft hyphens. */
function lengthClass(name: string | null) {
  const longest = Math.max(0, ...hyphenate(name ?? "").split(/[ \u00AD]/).map((w) => w.length));
  return longest > 8 ? "len-xl" : longest > 6 ? "len-l" : "";
}

function Seat({
  player: p,
  angle,
  rx,
  ry,
  team,
  charName,
  thinksName,
  selected,
  onSelect,
}: {
  player: Player;
  angle: number;
  rx: number;
  ry: number;
  team: Team | null;
  charName: string | null;
  thinksName: string | null;
  selected: boolean;
  onSelect: () => void;
}) {
  const x = 50 + rx * Math.sin(angle);
  const y = 50 - ry * Math.cos(angle);
  const tokens = p.reminders.filter((t) => t !== "Dead");
  const ghost = !p.alive && !p.usedGhostVote;
  return (
    <button
      type="button"
      className={`grim-seat ${team ?? "unassigned"} ${p.alive ? "" : "dead"} ${selected ? "selected" : ""}`}
      style={{ left: `${x}%`, top: `${y}%` }}
      onClick={onSelect}
      aria-pressed={selected}
      aria-label={`Seat ${p.seat}, ${p.name}, ${charName ?? "no character"}${p.alive ? "" : ", dead"}`}
    >
      <span className="grim-token">
        <span className={`grim-char ${lengthClass(charName)}`}>{charName ? hyphenate(charName) : "—"}</span>
        {thinksName && <span className={`grim-thinks ${lengthClass(thinksName)}`}>as {hyphenate(thinksName)}</span>}
        {!p.alive && <span className="grim-shroud" aria-hidden />}
        {ghost && <span className="grim-ghost" title="Ghost vote unused" />}
      </span>
      <span className="grim-name">
        {p.seat}. {shortName(p.name)}
        {p.isTraveller ? " (T)" : ""}
      </span>
      {tokens.length > 0 && (
        <span className="grim-reminders">
          {tokens.slice(0, MAX_TOKENS).map((t) => (
            <span key={t} className="grim-reminder">
              {t}
            </span>
          ))}
          {tokens.length > MAX_TOKENS && <span className="grim-reminder more">+{tokens.length - MAX_TOKENS}</span>}
        </span>
      )}
    </button>
  );
}
