import { useMemo, useState } from "react";
import type { CharacterDef, Deal, SetupCounts, StorytellerState, Team } from "../../types";

type EmitFn = (e: string, d?: unknown, ack?: (result: unknown) => void) => void;

const BAG_TEAMS: { team: Team; label: string }[] = [
  { team: "townsfolk", label: "Townsfolk" },
  { team: "outsider", label: "Outsiders" },
  { team: "minion", label: "Minions" },
  { team: "demon", label: "Demon" },
];

function countsText(c: SetupCounts) {
  return `T${c.townsfolk} / O${c.outsider} / M${c.minion} / D${c.demon}`;
}

/** Official counts for the table; the Baron moves two Townsfolk to Outsiders. */
function needFor(base: SetupCounts | null, baron: boolean): SetupCounts | null {
  if (!base) return null;
  return baron ? { ...base, townsfolk: Math.max(0, base.townsfolk - 2), outsider: base.outsider + 2 } : base;
}

/**
 * Deal a legal bag: random, or with characters the Storyteller wants in play. The preview stays on
 * this phone until "Put in grimoire"; the server checks the deal again before applying it.
 */
export function SetupWizard({ state, emit }: { state: StorytellerState; emit: EmitFn }) {
  const [include, setInclude] = useState<string[]>([]);
  const [choose, setChoose] = useState(false);
  const [deal, setDeal] = useState<Deal | null>(null);
  const [errors, setErrors] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);

  const residents = useMemo(
    () => state.players.filter((p) => !p.isTraveller && !p.leftGame).sort((a, b) => a.seat - b.seat),
    [state.players],
  );
  const byId = (id: string | null) => state.characters.find((c) => c.id === id);
  const need = needFor(state.officialSetup ?? null, choose && include.includes("baron"));
  const picked = useMemo(() => {
    const c: SetupCounts = { townsfolk: 0, outsider: 0, minion: 0, demon: 0 };
    for (const id of include) {
      const t = byId(id)?.team;
      if (t && t !== "traveller") c[t] += 1;
    }
    return c;
  }, [include, state.characters]);

  if (state.phase !== "lobby") {
    return (
      <div className="panel">
        <h2>Deal characters</h2>
        <p className="muted">Dealing is only available before the first night. Edit characters in the Grimoire tab.</p>
      </div>
    );
  }

  function preview() {
    setBusy(true);
    emit("game:previewDeal", { include: choose ? include : [] }, (r) => {
      setBusy(false);
      const res = r as { ok: boolean; deal?: Deal; errors?: string[]; error?: string };
      if (res.ok && res.deal) {
        setDeal(res.deal);
        setErrors([]);
      } else {
        setDeal(null);
        setErrors(res.errors ?? [res.error ?? "Could not deal."]);
      }
    });
  }

  function apply() {
    if (!deal) return;
    const assigned = residents.some((p) => p.characterId);
    if (assigned && !confirm("Replace the characters already in the grimoire with this deal?")) return;
    setBusy(true);
    emit("game:applyDeal", { deal }, (r) => {
      setBusy(false);
      const res = r as { ok: boolean; message?: string; error?: string };
      if (res.ok) {
        setDeal(null);
        setErrors([]);
      } else {
        setErrors([res.message ?? res.error ?? "The server refused the deal."]);
      }
    });
  }

  function toggle(id: string) {
    setInclude((prev) => (prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]));
    setDeal(null);
  }

  const bag = deal ? deal.seats.map((s) => s.characterId) : [];
  const drunkSeat = deal?.seats.find((s) => s.characterId === "drunk") ?? null;
  const ftInPlay = Boolean(
    deal?.seats.some((s) => s.characterId === "fortuneteller" || s.thinksCharacterId === "fortuneteller"),
  );
  const freeTownsfolk = state.characters.filter((c) => c.team === "townsfolk" && !bag.includes(c.id));
  const bluffChoices = state.characters.filter(
    (c) => (c.team === "townsfolk" || c.team === "outsider") && !bag.includes(c.id) && c.id !== drunkSeat?.thinksCharacterId,
  );
  const goodSeats = deal
    ? deal.seats.filter((s) => {
        const t = byId(s.characterId)?.team;
        return t === "townsfolk" || t === "outsider";
      })
    : [];

  function editDeal(patch: Partial<Deal>) {
    setDeal((d) => (d ? { ...d, ...patch } : d));
  }

  return (
    <div className="panel setup-wizard">
      <h2>Deal characters</h2>
      {need ? (
        <p className="muted">
          {residents.length} players need {countsText(need)}
          {choose && include.includes("baron") ? " (Baron: +2 Outsiders)" : ""}. The Drunk&apos;s Townsfolk, the Fortune
          Teller&apos;s red herring and three Demon bluffs are picked for you; change them before you apply.
        </p>
      ) : (
        <p className="warn">No official bag for {residents.length} players — use 5–15 (plus Travellers).</p>
      )}

      <div className="chip-row">
        <button type="button" className={`chip ${!choose ? "on" : ""}`} onClick={() => (setChoose(false), setDeal(null))}>
          Random bag
        </button>
        <button type="button" className={`chip ${choose ? "on" : ""}`} onClick={() => (setChoose(true), setDeal(null))}>
          Choose characters
        </button>
      </div>

      {choose && (
        <div className="wizard-pick">
          <p className="muted">
            Tap the characters you want in play; the rest is drawn at random. Picked {countsText(picked)}
            {need ? ` of ${countsText(need)}` : ""}.
          </p>
          {BAG_TEAMS.map(({ team, label }) => (
            <div key={team}>
              <div className={`wizard-team ${team}`}>{label}</div>
              <div className="chip-row">
                {state.characters
                  .filter((c) => c.team === team)
                  .map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      className={`chip ${include.includes(c.id) ? "on" : ""}`}
                      onClick={() => toggle(c.id)}
                    >
                      {c.name}
                    </button>
                  ))}
              </div>
            </div>
          ))}
          {include.length > 0 && (
            <button type="button" className="chip" onClick={() => (setInclude([]), setDeal(null))}>
              Clear picks
            </button>
          )}
        </div>
      )}

      <div className="row" style={{ marginTop: "0.75rem" }}>
        <button type="button" className={deal ? "" : "primary"} onClick={preview} disabled={busy || !need}>
          {deal ? "Deal again" : "Deal"}
        </button>
        {deal && (
          <button type="button" className="primary" onClick={apply} disabled={busy}>
            Put in grimoire
          </button>
        )}
      </div>

      {errors.length > 0 && (
        <ul className="warn wizard-errors">
          {errors.map((e) => (
            <li key={e}>{e}</li>
          ))}
        </ul>
      )}

      {deal && (
        <div className="wizard-preview">
          <p className="muted">
            Preview — only on this phone. {countsText(deal.counts)}
            {deal.baron ? " · Baron in play (+2 Outsiders)" : ""}
          </p>
          <ol className="wizard-seats">
            {deal.seats.map((s) => {
              const p = state.players.find((x) => x.id === s.playerId);
              const c = byId(s.characterId);
              return (
                <li key={s.playerId}>
                  <span className="wizard-seat-name">
                    {p?.seat}. {p?.name}
                  </span>
                  <span className={`badge ${c?.team ?? ""}`}>{c?.name ?? s.characterId}</span>
                  {s.characterId === "drunk" && (
                    <select
                      aria-label="The Drunk thinks they are"
                      value={s.thinksCharacterId ?? ""}
                      onChange={(e) =>
                        editDeal({
                          seats: deal.seats.map((x) =>
                            x.playerId === s.playerId ? { ...x, thinksCharacterId: e.target.value || null } : x,
                          ),
                          bluffs: deal.bluffs.filter((b) => b !== e.target.value),
                        })
                      }
                    >
                      {freeTownsfolk.map((t) => (
                        <option key={t.id} value={t.id}>
                          thinks: {t.name}
                        </option>
                      ))}
                    </select>
                  )}
                  {deal.redHerringId === s.playerId && <span className="badge">red herring</span>}
                </li>
              );
            })}
          </ol>

          {ftInPlay && (
            <label className="wizard-field">
              <span className="muted">Fortune Teller&apos;s red herring (a good player)</span>
              <select value={deal.redHerringId ?? ""} onChange={(e) => editDeal({ redHerringId: e.target.value || null })}>
                {goodSeats.map((s) => {
                  const p = state.players.find((x) => x.id === s.playerId);
                  return (
                    <option key={s.playerId} value={s.playerId}>
                      {p?.seat}. {p?.name} ({byId(s.characterId)?.name})
                    </option>
                  );
                })}
              </select>
            </label>
          )}

          <div className="wizard-field">
            <span className="muted">Demon bluffs (good characters not in play)</span>
            <div className="row">
              {[0, 1, 2].map((i) => (
                <select
                  key={i}
                  aria-label={`Bluff ${i + 1}`}
                  value={deal.bluffs[i] ?? ""}
                  onChange={(e) => {
                    const next = [...deal.bluffs];
                    next[i] = e.target.value;
                    editDeal({ bluffs: next });
                  }}
                >
                  <option value="">—</option>
                  {bluffChoices.map((c: CharacterDef) => (
                    <option key={c.id} value={c.id} disabled={deal.bluffs.includes(c.id) && deal.bluffs[i] !== c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
              ))}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
