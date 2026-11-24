import { GLYPH_H, GLYPH_W } from "../engine/font";
import { Input } from "../engine/input";
import { Renderer } from "../engine/renderer";
import { COLS, LEVELS, ROWS, TILE, isDoor, type Level } from "../shared/level";
import type { ClientMsg } from "../shared/protocol";
import { COLORS, GROUP_RADIUS, PLAYER_HP, PLAYER_SIZE, ZOMBIE_TYPES, type Snapshot, type ZombieType } from "../shared/sim";

export const WIDTH = COLS * TILE; // 320
export const HEIGHT = ROWS * TILE; // 176

const PALETTE = {
  wall: "#566c86",
  wallTop: "#333c57",
  floor: "#1a1c2c",
  floorAlt: "#212338",
  exit: "#38b764",
  blood: "#b13e53",
};
const ZOMBIE_LOOK: Record<ZombieType, { body: string; dark: string }> = {
  walker: { body: "#5d8a3a", dark: "#3b5d28" },
  runner: { body: "#c2d94a", dark: "#8a9b2c" },
  hulk: { body: "#7a4e8a", dark: "#4d2f5a" },
};
const LETTER_COLOR: Record<string, string> = { a: "#ffcd75", b: "#b13e53", c: "#41a6f6", d: "#a7f070" };

type Pos = { x: number; y: number };

/** Client-side view: sends input, renders the latest server snapshot. */
export class Game {
  private level: Level = LEVELS[0]!;
  private snap: Snapshot | null = null;
  private view = new Map<string, Pos>(); // eased positions, keyed by "p:<id>" / "z:<id>"
  private lastInput = "";

  constructor(
    private input: Input,
    private send: (m: ClientMsg) => void,
    private you: () => string,
  ) {}

  setLevel(level: Level): void {
    this.level = level;
  }

  setSnapshot(s: Snapshot): void {
    this.snap = s;
  }

  reset(): void {
    this.snap = null;
    this.view.clear();
    this.lastInput = "";
  }

  update(): void {
    const { x: dx, y: dy } = this.input.axis();
    const key = `${dx},${dy}`;
    if (key !== this.lastInput) {
      this.lastInput = key;
      this.send({ t: "input", dx, dy });
    }

    // Ease rendered positions toward the server's 30 Hz snapshots.
    const ease = (key: string, p: Pos) => {
      const v = this.view.get(key) ?? { x: p.x, y: p.y };
      v.x += (p.x - v.x) * 0.35;
      v.y += (p.y - v.y) * 0.35;
      this.view.set(key, v);
    };
    this.snap?.players.forEach((p) => ease(`p:${p.id}`, p));
    this.snap?.zombies.forEach((z) => ease(`z:${z.id}`, z));
    this.input.endFrame();
  }

  render(r: Renderer): void {
    r.clear(PALETTE.floor);
    this.drawLevel(r);
    const snap = this.snap;
    if (!snap) return;

    // Links between grouped players show who is protected.
    const alive = snap.players.filter((p) => p.alive);
    for (const a of alive) {
      for (const b of alive) {
        if (a.id >= b.id) continue;
        const va = this.view.get(`p:${a.id}`) ?? a;
        const vb = this.view.get(`p:${b.id}`) ?? b;
        if (Math.hypot(va.x - vb.x, va.y - vb.y) <= GROUP_RADIUS) {
          const h = PLAYER_SIZE / 2;
          r.line(va.x + h, va.y + h, vb.x + h, vb.y + h, "rgba(255,255,255,0.35)");
        }
      }
    }

    for (const z of snap.zombies) {
      const v = this.view.get(`z:${z.id}`) ?? z;
      const spec = ZOMBIE_TYPES[z.type];
      const look = ZOMBIE_LOOK[z.type];
      const s = spec.size;
      r.rect(v.x, v.y, s, s, look.body);
      r.rect(v.x, v.y + s - 3, s, 3, look.dark);
      r.rect(v.x + 2, v.y + 2, 2, 2, PALETTE.blood);
      r.rect(v.x + s - 4, v.y + 2, 2, 2, PALETTE.blood);
      this.bar(r, v, z.hp / spec.hp, PALETTE.blood, s);
    }

    const you = this.you();
    for (const p of snap.players) {
      const v = this.view.get(`p:${p.id}`) ?? p;
      if (!p.alive) {
        r.rect(v.x, v.y, PLAYER_SIZE, PLAYER_SIZE, "#566c86");
        r.line(v.x + 1, v.y + 1, v.x + PLAYER_SIZE - 2, v.y + PLAYER_SIZE - 2, "#1a1c2c");
        r.line(v.x + PLAYER_SIZE - 2, v.y + 1, v.x + 1, v.y + PLAYER_SIZE - 2, "#1a1c2c");
        continue;
      }
      if (p.id === you) r.rect(v.x - 1, v.y - 1, PLAYER_SIZE + 2, PLAYER_SIZE + 2, "#fff");
      // Alone = red outline: this player is vulnerable.
      else if (!p.grouped) r.rect(v.x - 1, v.y - 1, PLAYER_SIZE + 2, PLAYER_SIZE + 2, PALETTE.blood);
      r.rect(v.x, v.y, PLAYER_SIZE, PLAYER_SIZE, COLORS[p.slot] ?? "#fff");
      // The player's initial, centred inside their box.
      r.char(p.name.charAt(0) || "?", v.x + (PLAYER_SIZE - GLYPH_W) / 2, v.y + (PLAYER_SIZE - GLYPH_H) / 2, PALETTE.floor);
      this.bar(r, v, p.hp / PLAYER_HP, p.grouped ? "#a7f070" : "#ef7d57", PLAYER_SIZE);
    }
  }

  private bar(r: Renderer, v: Pos, frac: number, color: string, width: number): void {
    r.rect(v.x, v.y - 4, width, 2, "#000");
    r.rect(v.x, v.y - 4, Math.max(0, Math.round(width * frac)), 2, color);
  }

  private drawLevel(r: Renderer): void {
    const open = new Set(this.snap?.openDoors ?? []);
    const pressed = new Set(this.snap?.pressed ?? []);
    for (let ty = 0; ty < ROWS; ty++) {
      for (let tx = 0; tx < COLS; tx++) {
        const ch = this.level.at(tx, ty);
        const x = tx * TILE;
        const y = ty * TILE;
        if (ch === "#") {
          r.rect(x, y, TILE, TILE, PALETTE.wall);
          r.rect(x, y, TILE, 2, PALETTE.wallTop);
          continue;
        }
        if ((tx + ty) % 2 === 0) r.rect(x, y, TILE, TILE, PALETTE.floorAlt);
        if (ch === "E") r.rect(x + 2, y + 2, TILE - 4, TILE - 4, PALETTE.exit);
        if (isDoor(ch) && !open.has(ch)) {
          r.rect(x, y, TILE, TILE, LETTER_COLOR[ch] ?? "#fff");
          r.rect(x + 3, y + 3, TILE - 6, TILE - 6, PALETTE.wallTop);
        }
      }
    }
    for (const pl of this.level.plates) {
      const x = pl.tx * TILE + 2;
      const y = pl.ty * TILE + 2;
      r.rect(x, y, TILE - 4, TILE - 4, LETTER_COLOR[pl.door] ?? "#fff");
      if (!pressed.has(`${pl.tx},${pl.ty}`)) r.rect(x + 2, y + 2, TILE - 8, TILE - 8, PALETTE.floor);
    }
  }
}
