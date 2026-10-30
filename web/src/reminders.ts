/** "Wrong · Washerwoman" → "Wrong"; unlabeled "Red herring" stays "Red herring". */
export function reminderBase(reminder: string): string {
  const cut = reminder.indexOf(" · ");
  return cut === -1 ? reminder : reminder.slice(0, cut);
}

export function playerHasReminder(p: { reminders: string[] }, base: string): boolean {
  return p.reminders.some((r) => reminderBase(r) === base);
}

const BARE_TO_ROLE: Record<string, string> = {
  "Red herring": "Fortune Teller",
  Townsfolk: "Washerwoman",
  Outsider: "Librarian",
  Minion: "Investigator",
  Poisoned: "Poisoner",
  Safe: "Monk",
  Master: "Butler",
};

const ROLE_SHORT: Record<string, string> = {
  Washerwoman: "WW",
  Librarian: "Lib",
  Investigator: "Inv",
  "Fortune Teller": "FT",
};

/** Full token text for the Spy overlay / editor: "Red herring · Fortune Teller". */
export function displayReminder(reminder: string): string {
  if (reminder.includes(" · ")) return reminder;
  const role = BARE_TO_ROLE[reminder];
  return role ? `${reminder} · ${role}` : reminder;
}

/** Compact token text for the Storyteller circle. */
export function compactReminder(reminder: string): string {
  const labeled = displayReminder(reminder);
  const cut = labeled.indexOf(" · ");
  if (cut === -1) return labeled;
  const left = labeled.slice(0, cut);
  const right = labeled.slice(cut + 3);
  return `${left} · ${ROLE_SHORT[right] ?? right}`;
}
