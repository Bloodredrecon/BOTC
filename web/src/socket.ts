import { io, Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState, StorytellerState } from "./types";

export const NOT_CONNECTED = "Not connected to the server, so that was not sent. Try again once reconnected.";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);
  /** Set when an action was dropped because the socket was down. */
  const [droppedAt, setDroppedAt] = useState<number | null>(null);

  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
      reconnectionDelayMax: 3000,
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    // A sleeping tablet/TV may miss reconnect attempts; retry at once when it wakes.
    const onVisible = () => {
      if (document.visibilityState === "visible" && !socket.connected) socket.connect();
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      document.removeEventListener("visibilitychange", onVisible);
      socket.disconnect();
    };
  }, []);

  /**
   * Never queue while offline: socket.io would replay the event on reconnect before the
   * Storyteller re-joins, so the server refuses it and the tap is silently lost.
   */
  const emit = useCallback((event: string, data?: unknown, ack?: (result: unknown) => void) => {
    const socket = socketRef.current;
    if (!socket?.connected) {
      setDroppedAt(Date.now());
      ack?.({ ok: false, error: NOT_CONNECTED });
      return;
    }
    if (ack) socket.emit(event, data, ack);
    else socket.emit(event, data);
  }, []);

  return { socketRef, connected, emit, droppedAt };
}

export type Presence = { tv: number; tvChangedAt: number; storytellers: number };

export function useTvState(socketRef: React.MutableRefObject<Socket | null>) {
  const [state, setState] = useState<PublicState | null>(null);
  const [joined, setJoined] = useState(false);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket) return;

    const onState = (s: PublicState) => setState(s);
    const join = () => {
      socket.emit("join", { role: "tv" });
      setJoined(true);
    };

    socket.on("state:public", onState);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("state:public", onState);
      socket.off("connect", join);
    };
  }, [socketRef]);

  return { state, joined };
}

/**
 * `attempt` must change on every Unlock press: re-submitting the same PIN (e.g. after a
 * "try again in N s" refusal) would otherwise not re-run the join.
 */
export function useStoryteller(
  socketRef: React.MutableRefObject<Socket | null>,
  pin: string | null,
  attempt = 0,
) {
  const [state, setState] = useState<StorytellerState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [retryAt, setRetryAt] = useState<number | null>(null);
  const [authed, setAuthed] = useState(false);
  const [pinIsDefault, setPinIsDefault] = useState(false);
  const [presence, setPresence] = useState<Presence | null>(null);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !pin) return;

    const onState = (s: StorytellerState) => {
      setState(s);
      setAuthed(true);
      setAuthError(null);
      setRetryAt(null);
    };
    const onAuthErr = (e: { message: string; retryAfterMs?: number }) => {
      setAuthError(e.message);
      setRetryAt(e.retryAfterMs ? Date.now() + e.retryAfterMs : null);
      setAuthed(false);
    };
    const onAuthInfo = (i: { pinIsDefault?: boolean }) => setPinIsDefault(Boolean(i.pinIsDefault));
    const join = () => socket.emit("join", { role: "storyteller", pin });

    socket.on("state:storyteller", onState);
    socket.on("auth:error", onAuthErr);
    socket.on("auth:info", onAuthInfo);
    socket.on("presence", setPresence);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("state:storyteller", onState);
      socket.off("auth:error", onAuthErr);
      socket.off("auth:info", onAuthInfo);
      socket.off("presence", setPresence);
      socket.off("connect", join);
    };
  }, [socketRef, pin, attempt]);

  return { state, authError, authed, retryAt, pinIsDefault, presence };
}
