# Hue Bridge setup

1. Open the Philips Hue app and note your Bridge is on the same LAN as the BOTC **server** (not only the phone).
2. Create an API user (press the Bridge link button, then POST to `http://<bridge-ip>/api` with `{"devicetype":"botc-companion#server"}`).
3. Copy `config/hue.json.example` to `config/hue.json`.
4. Fill in `bridgeIp`, `username`, and the three light IDs for:
   - `ambient` — main room wash
   - `accent` — secondary / timers
   - `effect` — execution / death
5. Set `"enabled": true`.
6. Restart the server. `/api/health` should report `hueLive: true`.

If the Bridge is unreachable, the server stays in stub mode and logs `[hue:stub] scene=…`. Gameplay is never blocked.
