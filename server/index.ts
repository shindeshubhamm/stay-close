import { join, normalize } from "node:path";
import { LEVELS } from "../src/shared/level";
import type { ClientMsg, LobbyPlayer, Phase, ServerMsg } from "../src/shared/protocol";
import { MAX_PLAYERS, World } from "../src/shared/sim";

const PORT = Number(process.env.PORT ?? 3001);
const TICK_HZ = 30;
const DIST = join(import.meta.dir, "..", "dist");

interface Conn { id: string; name: string; slot: number; room?: Room }
type Socket = Bun.ServerWebSocket<Conn>;

class Room {
  phase: Phase = "lobby";
  level = 0;
  hostId = "";
  members = new Map<string, Socket>();
  world: World | null = null;
  timer: ReturnType<typeof setInterval> | null = null;

  constructor(readonly code: string) {}

  add(ws: Socket): boolean {
    if (this.members.size >= MAX_PLAYERS || this.phase === "playing") return false;
    const taken = new Set([...this.members.values()].map((m) => m.data.slot));
    ws.data.slot = Array.from({ length: MAX_PLAYERS }, (_, i) => i).find((s) => !taken.has(s))!;
    ws.data.room = this;
    this.members.set(ws.data.id, ws);
    if (!this.hostId) this.hostId = ws.data.id;
    send(ws, { t: "joined", you: ws.data.id });
    this.broadcastLobby();
    return true;
  }

  remove(ws: Socket): void {
    this.members.delete(ws.data.id);
    this.world?.removePlayer(ws.data.id);
    if (this.members.size === 0) return this.close();
    if (this.hostId === ws.data.id) this.hostId = [...this.members.keys()][0]!;
    this.broadcastLobby();
  }

  /** From the lobby: optionally pick a level. After a win: next level. After a loss: retry. */
  start(level?: number): void {
    if (this.phase === "lobby" && Number.isInteger(level) && level! >= 0 && level! < LEVELS.length) this.level = level!;
    else if (this.phase === "won") this.level = (this.level + 1) % LEVELS.length;
    this.world = new World(LEVELS[this.level]!);
    for (const m of this.members.values()) this.world.addPlayer(m.data.id, m.data.name, m.data.slot);
    this.phase = "playing";
    this.broadcastLobby();
    this.timer = setInterval(() => this.tick(), 1000 / TICK_HZ);
  }

  private tick(): void {
    const world = this.world!;
    world.step(1 / TICK_HZ);
    this.broadcast({ t: "state", snap: world.snapshot() });
    if (world.won || world.lost) {
      this.phase = world.won ? "won" : "lost";
      this.stopTimer();
      this.broadcastLobby();
    }
  }

  private stopTimer(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  private close(): void {
    this.stopTimer();
    rooms.delete(this.code);
  }

  broadcastLobby(): void {
    const players: LobbyPlayer[] = [...this.members.values()].map((m) => ({
      id: m.data.id,
      name: m.data.name,
      slot: m.data.slot,
    }));
    this.broadcast({ t: "lobby", code: this.code, hostId: this.hostId, phase: this.phase, level: this.level, players });
  }

  private broadcast(msg: ServerMsg): void {
    const data = JSON.stringify(msg);
    for (const m of this.members.values()) m.send(data);
  }
}

const rooms = new Map<string, Room>();

function send(ws: Socket, msg: ServerMsg): void {
  ws.send(JSON.stringify(msg));
}

function newCode(): string {
  const letters = "ABCDEFGHJKLMNPQRSTUVWXYZ";
  let code: string;
  do {
    code = Array.from({ length: 4 }, () => letters[Math.floor(Math.random() * letters.length)]).join("");
  } while (rooms.has(code));
  return code;
}

const cleanName = (n: unknown) => String(n ?? "").trim().slice(0, 12) || "Player";

function handle(ws: Socket, msg: ClientMsg): void {
  const room = ws.data.room;
  switch (msg.t) {
    case "create": {
      if (room) return;
      ws.data.name = cleanName(msg.name);
      const r = new Room(newCode());
      rooms.set(r.code, r);
      r.add(ws);
      return;
    }
    case "join": {
      if (room) return;
      ws.data.name = cleanName(msg.name);
      const r = rooms.get(String(msg.code ?? "").toUpperCase());
      if (!r) return send(ws, { t: "error", msg: "Room not found" });
      if (!r.add(ws)) send(ws, { t: "error", msg: "Room is full or already playing" });
      return;
    }
    case "start":
      if (room && room.hostId === ws.data.id && room.phase !== "playing") room.start(msg.level);
      return;
    case "input":
      room?.world?.setInput(ws.data.id, Number(msg.dx) || 0, Number(msg.dy) || 0);
      return;
  }
}

Bun.serve<Conn>({
  port: PORT,
  async fetch(req, server) {
    const url = new URL(req.url);
    if (url.pathname === "/ws") {
      const ok = server.upgrade(req, { data: { id: crypto.randomUUID(), name: "", slot: 0 } });
      return ok ? undefined : new Response("Upgrade failed", { status: 400 });
    }
    // Serve the production build (bun run build) so one process hosts everything.
    const path = normalize(join(DIST, url.pathname === "/" ? "index.html" : url.pathname));
    const file = path.startsWith(DIST) ? Bun.file(path) : null;
    if (file && (await file.exists())) return new Response(file);
    return new Response("Not found", { status: 404 });
  },
  websocket: {
    message(ws, raw) {
      try {
        handle(ws, JSON.parse(String(raw)) as ClientMsg);
      } catch {
        /* ignore malformed messages */
      }
    },
    close(ws) {
      ws.data.room?.remove(ws);
    },
  },
});

console.log(`Game server listening on http://localhost:${PORT} (ws path: /ws)`);
