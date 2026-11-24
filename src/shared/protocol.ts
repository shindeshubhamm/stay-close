import type { Snapshot } from "./sim";

export type Phase = "lobby" | "playing" | "won" | "lost";

export type ClientMsg =
  | { t: "create"; name: string }
  | { t: "join"; code: string; name: string }
  | { t: "start"; level?: number } // level is only honoured from the lobby
  | { t: "input"; dx: number; dy: number };

export interface LobbyPlayer { id: string; name: string; slot: number }

export type ServerMsg =
  | { t: "joined"; you: string }
  | { t: "lobby"; code: string; hostId: string; phase: Phase; level: number; players: LobbyPlayer[] }
  | { t: "state"; snap: Snapshot }
  | { t: "error"; msg: string };
