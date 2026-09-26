import { io, Socket } from "socket.io-client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PublicState, StorytellerState } from "./types";

export function useSocket() {
  const socketRef = useRef<Socket | null>(null);
  const [connected, setConnected] = useState(false);

  useEffect(() => {
    const socket = io({
      path: "/socket.io",
      transports: ["websocket", "polling"],
    });
    socketRef.current = socket;
    socket.on("connect", () => setConnected(true));
    socket.on("disconnect", () => setConnected(false));
    return () => {
      socket.disconnect();
    };
  }, []);

  const emit = useCallback((event: string, data?: unknown, ack?: (result: unknown) => void) => {
    if (ack) socketRef.current?.emit(event, data, ack);
    else socketRef.current?.emit(event, data);
  }, []);

  return { socketRef, connected, emit };
}

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

export function useStoryteller(
  socketRef: React.MutableRefObject<Socket | null>,
  pin: string | null,
) {
  const [state, setState] = useState<StorytellerState | null>(null);
  const [authError, setAuthError] = useState<string | null>(null);
  const [authed, setAuthed] = useState(false);

  useEffect(() => {
    const socket = socketRef.current;
    if (!socket || !pin) return;

    const onState = (s: StorytellerState) => {
      setState(s);
      setAuthed(true);
      setAuthError(null);
    };
    const onAuthErr = (e: { message: string }) => {
      setAuthError(e.message);
      setAuthed(false);
    };
    const join = () => socket.emit("join", { role: "storyteller", pin });

    socket.on("state:storyteller", onState);
    socket.on("auth:error", onAuthErr);
    socket.on("connect", join);
    if (socket.connected) join();

    return () => {
      socket.off("state:storyteller", onState);
      socket.off("auth:error", onAuthErr);
      socket.off("connect", join);
    };
  }, [socketRef, pin]);

  return { state, authError, authed };
}
