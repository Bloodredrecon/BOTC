/**
 * Lobby "Ready to begin" checklist. Server is the source of truth so Start first night
 * cannot be bypassed by a raw socket emit; the Storyteller UI mirrors this.
 */
import { EVIL_INFO_MIN_PLAYERS } from "./night.js";
import type { ScriptData } from "./persistence.js";
import { revealFor } from "./phones.js";
import { setupWarning } from "./projection.js";
import { trueCharacterId, wakeCharacterId } from "./rules.js";
import type { GameSession } from "./types.js";

export type SetupReadinessItem = {
  id: string;
  label: string;
  ok: boolean;
  /** When true, blocks Start first night unless the Storyteller uses the override. */
  hard: boolean;
};

export type SetupReadiness = {
  items: SetupReadinessItem[];
  /** All hard items are ok. */
  ready: boolean;
  /** Checklist applies (lobby only). */
  applicable: boolean;
};

const DEFAULT_NAME = /^Player\s+\d+$/i;

function hasFortuneTeller(session: GameSession, script: ScriptData): boolean {
  return session.players.some((p) => {
    if (p.leftGame || p.isTraveller) return false;
    return wakeCharacterId(p) === "fortuneteller" || trueCharacterId(script, p) === "fortuneteller";
  });
}

function demonPlayer(session: GameSession, script: ScriptData) {
  return session.players.find((p) => {
    if (p.leftGame || p.isTraveller) return false;
    const id = trueCharacterId(script, p);
    return script.characters.find((c) => c.id === id)?.team === "demon";
  });
}

function phoneCardsCurrent(session: GameSession, script: ScriptData): boolean {
  const seated = session.players.filter((p) => !p.leftGame);
  if (!seated.length) return false;
  for (const p of seated) {
    const priv = session.phones.private[p.id];
    if (!priv?.revealedCharacterId) return false;
    const want = revealFor(script, p);
    if ("error" in want) return false;
    if (priv.revealedCharacterId !== want.characterId) return false;
    if (p.isTraveller && priv.revealedAlignment !== want.alignment) return false;
  }
  return true;
}

/** Compute the lobby readiness checklist. Outside lobby, applicable is false. */
export function computeSetupReadiness(session: GameSession, script: ScriptData): SetupReadiness {
  const applicable = session.phase === "lobby";
  const residents = session.players.filter((p) => !p.isTraveller && !p.leftGame);
  const bagWarn = setupWarning(session, script);
  const allAssigned = residents.length > 0 && residents.every((p) => Boolean(p.characterId));
  const namesOk = residents.length > 0 && residents.every((p) => {
    const n = (p.name ?? "").trim();
    return n.length > 0 && !DEFAULT_NAME.test(n);
  });

  const drunks = residents.filter((p) => p.characterId === "drunk");
  const drunkOk =
    drunks.length === 0 ||
    drunks.every((p) => {
      if (!p.thinksCharacterId) return false;
      const thinks = script.characters.find((c) => c.id === p.thinksCharacterId);
      if (thinks?.team !== "townsfolk") return false;
      return !residents.some(
        (x) => x.id !== p.id && trueCharacterId(script, x) === p.thinksCharacterId,
      );
    });

  const needBluffs = residents.length >= EVIL_INFO_MIN_PLAYERS && Boolean(demonPlayer(session, script));
  const demon = demonPlayer(session, script);
  const bluffsOk =
    !needBluffs || Boolean(demon && new Set(demon.bluffs.filter(Boolean)).size >= 3);

  const needHerring = hasFortuneTeller(session, script);
  const herringOk =
    !needHerring ||
    session.players.some((p) => !p.leftGame && p.reminders.some((r) => /red herring/i.test(r)));

  const phonesOff = !session.phones.enabled;
  const pendingClaims = session.phones.claims.filter((c) => c.status === "pending").length;
  const phonesReady =
    phonesOff || (phoneCardsCurrent(session, script) && pendingClaims === 0);

  const items: SetupReadinessItem[] = [
    {
      id: "tv",
      label: "TV connected",
      ok: Boolean(session.tvConnected),
      hard: true,
    },
    {
      id: "tvSound",
      label: "TV sound confirmed (Enable sound on the TV)",
      ok: Boolean(session.tvSoundReady),
      hard: true,
    },
    {
      id: "names",
      label: "Player names entered (not the default Player N)",
      ok: namesOk,
      hard: true,
    },
    {
      id: "bag",
      label: bagWarn ? `Legal bag — ${bagWarn}` : "Legal bag for this player count",
      ok: !bagWarn && allAssigned,
      hard: true,
    },
    {
      id: "assigned",
      label: "Every resident has a character",
      ok: allAssigned,
      hard: true,
    },
    {
      id: "drunk",
      label:
        drunks.length === 0
          ? "Drunk belief (not needed — no Drunk)"
          : 'Drunk “thinks they are” set to a Townsfolk not in play',
      ok: drunkOk,
      hard: drunks.length > 0,
    },
    {
      id: "bluffs",
      label: needBluffs
        ? "Three Demon bluffs set on the Demon"
        : residents.length < EVIL_INFO_MIN_PLAYERS
          ? `Demon bluffs (not needed under ${EVIL_INFO_MIN_PLAYERS} players)`
          : "Demon bluffs (not needed — no Demon yet)",
      ok: bluffsOk,
      hard: needBluffs,
    },
    {
      id: "redHerring",
      label: needHerring
        ? "Fortune Teller red herring marked"
        : "Red herring (not needed — no Fortune Teller)",
      ok: herringOk,
      hard: needHerring,
    },
    {
      id: "phones",
      label: phonesOff
        ? "Phones off (physical tokens)"
        : pendingClaims > 0
          ? `Phones — ${pendingClaims} seat claim${pendingClaims === 1 ? "" : "s"} still waiting`
          : phoneCardsCurrent(session, script)
            ? "Phones — characters sent"
            : "Phones on — send characters to phones",
      ok: phonesReady,
      hard: true,
    },
  ];

  const ready = items.filter((i) => i.hard).every((i) => i.ok);
  return { items, ready, applicable };
}
