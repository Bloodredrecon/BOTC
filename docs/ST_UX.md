# Storyteller UX (Trouble Brewing)

Short notes for the setup → night → dawn → votes streamlining (Oct 2026).

## Ready to begin

In lobby, **Setup** shows a persistent checklist (TV connected, TV sound confirmed, names, legal bag, assignments, Drunk / bluffs / red herring when needed, phones off **or** characters sent with no pending claims). The server refuses `game:startFirstNight` / lobby `game:advancePhase` until hard items pass, unless `override: true` (**Start anyway — Storyteller override**).

TV sound is reported only after `/tv` **Enable sound** (`tv:soundReady`) — not from connection alone. See `docs/AUDIO.md`.

## Setup order

Operational order: players and names → phone claims → deal path (companion vs physical bag) → character delivery → TV / sheet → optional Fabled → Ready to begin.

## Night / dawn / votes

- Night wakes: after **Hide**, **Done → next** is primary; Skip / End night sit under **Overrides…**.
- Dawn: one main **Announce deaths → Day N**; skip announcement needs confirm; **Enter dawn** hidden while already in dawn.
- Votes flow bar includes the same **Next** as Control; **Open nominations** is highlighted at dusk when still closed.
- Voting mode leads with Manual vs Phone-assisted, with a short seat summary.
