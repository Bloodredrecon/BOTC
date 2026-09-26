import type { GameSession, Player } from "./types.js";

/** Remove a reminder string from every player. */
export function clearReminderEverywhere(session: GameSession, reminder: string) {
  for (const p of session.players) {
    if (p.reminders.includes(reminder)) {
      p.reminders = p.reminders.filter((r) => r !== reminder);
    }
  }
}

/** Remove reminder from a specific set of players. */
export function clearReminderFrom(players: Player[], reminder: string) {
  for (const p of players) {
    if (p.reminders.includes(reminder)) {
      p.reminders = p.reminders.filter((r) => r !== reminder);
    }
  }
}

export function addReminder(p: Player, reminder: string) {
  if (!p.reminders.includes(reminder)) {
    p.reminders = [...p.reminders, reminder];
  }
}

/** Exclusive marks: at most one player holds the token. */
export function placeExclusiveReminder(session: GameSession, playerId: string, reminder: string) {
  clearReminderEverywhere(session, reminder);
  const p = session.players.find((x) => x.id === playerId);
  if (p) addReminder(p, reminder);
}

export function hasReminder(session: GameSession, reminder: string | RegExp): boolean {
  return session.players.some((p) =>
    typeof reminder === "string"
      ? p.reminders.includes(reminder)
      : p.reminders.some((r) => reminder.test(r)),
  );
}

/** Decoy token for a specific info ability (Washerwoman / Librarian / Investigator). */
export function wrongReminderLabel(infoRoleLabel: string): string {
  return `Wrong · ${infoRoleLabel}`;
}

/**
 * Washerwoman / Librarian / Investigator pair marks.
 * Places the positive token on whoever in the pair actually has shownCharacterId;
 * labeled Wrong on the other. If neither matches, Wrong on both (ST can edit when lying).
 * Zero-outsiders: clear positive + this role's Wrong only, place nothing.
 */
export function placeInfoPairReminders(
  session: GameSession,
  opts: {
    positiveLabel: "Townsfolk" | "Outsider" | "Minion";
    /** Display name of the info role that placed the pair (e.g. Washerwoman). */
    infoRoleLabel: string;
    playerIds: string[];
    shownCharacterId: string | null;
    zeroOutsiders?: boolean;
  },
): string {
  const { positiveLabel, infoRoleLabel, playerIds, shownCharacterId, zeroOutsiders } = opts;
  const wrongLabel = wrongReminderLabel(infoRoleLabel);
  const pair = playerIds
    .map((id) => session.players.find((p) => p.id === id))
    .filter((p): p is Player => !!p);

  clearReminderEverywhere(session, positiveLabel);
  // Exclusive to this info ability — leave other roles' Wrong · … tokens alone.
  clearReminderEverywhere(session, wrongLabel);

  if (zeroOutsiders) {
    // Drop legacy bare Wrong on the (empty) selection if any were passed.
    clearReminderFrom(pair, "Wrong");
    return `Cleared ${positiveLabel} / ${wrongLabel} tokens (zero Outsiders shown). Edit grimoire if lying.`;
  }

  if (pair.length < 2 || !shownCharacterId) {
    return `Need 2 players + a character token to place ${positiveLabel} / ${wrongLabel}.`;
  }

  // Legacy bare Wrong on this pair (unlabeled decoys from older sessions).
  clearReminderFrom(pair, "Wrong");

  const correct = pair.filter((p) => p.characterId === shownCharacterId);
  if (correct.length >= 1) {
    const hit = correct[0];
    addReminder(hit, positiveLabel);
    for (const p of pair) {
      if (p.id !== hit.id) addReminder(p, wrongLabel);
    }
    return `Placed ${positiveLabel} on ${hit.name}, ${wrongLabel} on the other (truth from characterIds). Edit grimoire if Drunk/poisoned info should lie.`;
  }

  for (const p of pair) addReminder(p, wrongLabel);
  return `Neither selected player has ${shownCharacterId} — ${wrongLabel} on both. Edit grimoire if you showed a bluff on purpose.`;
}
