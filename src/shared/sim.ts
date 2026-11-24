import { COLS, ROWS, TILE, isDoor, type Level, type ZombieType } from "./level";

export type { ZombieType };

export const PLAYER_SIZE = 10;
export const PLAYER_SPEED = 70; // px / second
export const MAX_PLAYERS = 5;
export const COLORS = ["#ffcd75", "#41a6f6", "#a7f070", "#ef7d57", "#d77bba"] as const;

export const PLAYER_HP = 100;
/** A player with a living ally this close is "grouped": immune to bites and hits hard. */
export const GROUP_RADIUS = 44;

export const ZOMBIE_TYPES = {
  /** Hunts isolated players; otherwise spreads out so every group member is pressured. */
  walker: { speed: 34, hp: 50, dps: 15, size: 10, mass: 1 },
  /** Fast and fragile. Goes for stragglers and cuts them off from the group. */
  runner: { speed: 52, hp: 25, dps: 12, size: 9, mass: 0.7 },
  /** Slow and tanky. Rams the middle of the group and shoves players apart. */
  hulk: { speed: 24, hp: 160, dps: 25, size: 12, mass: 5 },
} as const satisfies Record<ZombieType, { speed: number; hp: number; dps: number; size: number; mass: number }>;

const DPS_GROUPED = 12;
const DPS_ALONE = 3;
const AGGRO_RANGE = 130; // a zombie that sees a player becomes alerted for good
const ALERT_SPREAD = 80; // ...and alerts nearby zombies
const SHOVE_SPEED = 60; // hulks push players away (players walk at 70)
const MAX_ZOMBIES = 10;
const PLAYER_MASS = 2; // heavier than walkers, lighter than hulks

export interface PlayerState {
  id: string;
  name: string;
  slot: number;
  x: number;
  y: number;
  hp: number;
  alive: boolean;
  grouped: boolean;
}

export interface ZombieState { id: number; type: ZombieType; x: number; y: number; hp: number }
interface Zombie extends ZombieState { alerted: boolean }

export interface Snapshot {
  players: PlayerState[];
  zombies: ZombieState[];
  openDoors: string[];
  pressed: string[]; // "tx,ty" of plates currently held down
  won: boolean;
  lost: boolean;
}

type Box = { x: number; y: number };
type Pt = { x: number; y: number };
const dist = (ax: number, ay: number, bx: number, by: number) => Math.hypot(ax - bx, ay - by);
const tileOf = (v: number) => Math.floor(v / TILE);
const pc = (p: Box): Pt => ({ x: p.x + PLAYER_SIZE / 2, y: p.y + PLAYER_SIZE / 2 });
const zc = (z: Zombie): Pt => {
  const h = ZOMBIE_TYPES[z.type].size / 2;
  return { x: z.x + h, y: z.y + h };
};

/**
 * Authoritative game simulation. Runs on the server; pure and network-free.
 *
 * Players near an ally are grouped: immune to bites and deadly to zombies.
 * Lone players take damage and barely hurt zombies. Zombies know this and try
 * to split the team: walkers spread out and pick off the isolated, runners cut
 * stragglers off from the group, hulks ram the middle and shove people apart.
 * All bodies collide with each other and with walls.
 */
export class World {
  private players = new Map<string, PlayerState>();
  private inputs = new Map<string, { dx: number; dy: number }>();
  private zombies: Zombie[] = [];
  private openDoors = new Set<string>();
  private pressed = new Set<string>();
  private nextId = 0;
  private time = 0;
  private nextWave: number;
  private waves = 0;
  won = false;
  lost = false;

  constructor(private level: Level) {
    for (const z of level.zombies) this.spawnZombie(z.type, z.tx * TILE + TILE / 2, z.ty * TILE + TILE / 2, false);
    this.nextWave = level.reinforceEvery;
  }

  addPlayer(id: string, name: string, slot: number): void {
    const s = this.level.spawns[slot % this.level.spawns.length]!;
    this.players.set(id, {
      id,
      name,
      slot,
      x: s.tx * TILE + (TILE - PLAYER_SIZE) / 2,
      y: s.ty * TILE + (TILE - PLAYER_SIZE) / 2,
      hp: PLAYER_HP,
      alive: true,
      grouped: false,
    });
  }

  removePlayer(id: string): void {
    this.players.delete(id);
    this.inputs.delete(id);
  }

  setInput(id: string, dx: number, dy: number): void {
    const clamp = (v: number) => Math.max(-1, Math.min(1, v));
    this.inputs.set(id, { dx: clamp(dx), dy: clamp(dy) });
  }

  step(dt: number): void {
    if (this.won || this.lost) return;
    this.time += dt;
    const alive = [...this.players.values()].filter((p) => p.alive);

    for (const p of alive) {
      const input = this.inputs.get(p.id);
      if (!input) continue;
      const len = Math.max(1, Math.hypot(input.dx, input.dy));
      this.move(p, PLAYER_SIZE, (input.dx / len) * PLAYER_SPEED * dt, (input.dy / len) * PLAYER_SPEED * dt);
    }

    for (const p of this.players.values()) {
      const c = pc(p);
      p.grouped = p.alive && alive.some((o) => o !== p && dist(pc(o).x, pc(o).y, c.x, c.y) <= GROUP_RADIUS);
    }

    this.reinforce(alive);
    this.moveZombies(alive, dt);
    this.combat(alive, dt);
    this.separate(alive);

    const living = alive.filter((p) => p.alive);
    this.updatePlates(living);
    if (this.players.size > 0 && living.length === 0) this.lost = true;
    else if (living.length > 0 && living.every((p) => this.tileUnder(p) === "E")) this.won = true;
  }

  snapshot(): Snapshot {
    const r = (v: number) => Math.round(v * 10) / 10;
    return {
      players: [...this.players.values()].map((p) => ({ ...p, x: r(p.x), y: r(p.y), hp: Math.ceil(p.hp) })),
      zombies: this.zombies.map((z) => ({ id: z.id, type: z.type, x: r(z.x), y: r(z.y), hp: Math.ceil(z.hp) })),
      openDoors: [...this.openDoors],
      pressed: [...this.pressed],
      won: this.won,
      lost: this.lost,
    };
  }

  // --- zombies -------------------------------------------------------------

  private spawnZombie(type: ZombieType, cx: number, cy: number, alerted: boolean): void {
    const spec = ZOMBIE_TYPES[type];
    this.zombies.push({ id: this.nextId++, type, x: cx - spec.size / 2, y: cy - spec.size / 2, hp: spec.hp, alerted });
  }

  /** Extra zombies arrive over time, from the spawn point farthest from the players. */
  private reinforce(alive: PlayerState[]): void {
    const every = this.level.reinforceEvery;
    if (!every || this.time < this.nextWave || alive.length === 0) return;
    this.nextWave = this.time + every;
    if (this.zombies.length >= MAX_ZOMBIES) return;
    const farthest = (t: { tx: number; ty: number }) =>
      Math.min(...alive.map((p) => dist(pc(p).x, pc(p).y, t.tx * TILE + 8, t.ty * TILE + 8)));
    const pool = this.level.zombies.filter((z) => z.type === "walker");
    const spawns = (pool.length ? pool : this.level.zombies).slice().sort((a, b) => farthest(b) - farthest(a));
    const at = spawns[0];
    if (!at || farthest(at) < 60) return;
    const n = this.waves++;
    const type: ZombieType = n % 8 === 7 ? "hulk" : n % 3 === 2 ? "runner" : "walker";
    this.spawnZombie(type, at.tx * TILE + TILE / 2, at.ty * TILE + TILE / 2, true);
  }

  private moveZombies(alive: PlayerState[], dt: number): void {
    if (alive.length === 0) return;
    for (const z of this.zombies) {
      const c = zc(z);
      if (!z.alerted && alive.some((p) => dist(pc(p).x, pc(p).y, c.x, c.y) <= AGGRO_RANGE)) z.alerted = true;
    }
    for (const z of this.zombies) {
      if (!z.alerted) continue;
      for (const o of this.zombies) if (!o.alerted && dist(zc(z).x, zc(z).y, zc(o).x, zc(o).y) <= ALERT_SPREAD) o.alerted = true;
    }

    const cen = {
      x: alive.reduce((s, p) => s + pc(p).x, 0) / alive.length,
      y: alive.reduce((s, p) => s + pc(p).y, 0) / alive.length,
    };
    const fromCen = (p: PlayerState) => dist(pc(p).x, pc(p).y, cen.x, cen.y);
    const assigned = new Map<string, number>();
    const load = (p: PlayerState) => assigned.get(p.id) ?? 0;

    for (const z of this.zombies) {
      if (!z.alerted) continue;
      const spec = ZOMBIE_TYPES[z.type];
      const c = zc(z);
      const near = (p: PlayerState) => dist(pc(p).x, pc(p).y, c.x, c.y);

      let order: PlayerState[];
      if (z.type === "hulk") {
        order = [...alive].sort((a, b) => fromCen(a) - fromCen(b)); // ram the middle
      } else if (z.type === "runner") {
        // Isolated first; otherwise the straggler farthest from the group.
        order = [...alive].sort((a, b) => Number(a.grouped) - Number(b.grouped) || (a.grouped ? fromCen(b) - fromCen(a) : near(a) - near(b)));
      } else {
        // Isolated first; among grouped players, spread out so nobody is left alone with the group.
        order = [...alive].sort((a, b) => Number(a.grouped) - Number(b.grouped) || load(a) - load(b) || near(a) - near(b));
      }

      for (const p of order) {
        const target = pc(p);
        let ok = false;
        if (z.type === "runner" && p.grouped && fromCen(p) > 1) {
          // Cut-off: approach from the group's side so our body shoves the straggler outward.
          const k = (PLAYER_SIZE / 2 + spec.size / 2 + 1) / fromCen(p);
          ok = this.chase(z, { x: target.x + (cen.x - target.x) * k, y: target.y + (cen.y - target.y) * k }, dt);
        }
        if (!ok) ok = this.chase(z, target, dt);
        if (ok) {
          assigned.set(p.id, load(p) + 1);
          break;
        }
      }
    }
  }

  /** Move one step toward `aim` along the shortest walkable path. False if unreachable. */
  private chase(z: Zombie, aim: Pt, dt: number): boolean {
    const spec = ZOMBIE_TYPES[z.type];
    const c = zc(z);
    let gx = aim.x;
    let gy = aim.y;
    const [zt, zu, at, au] = [tileOf(c.x), tileOf(c.y), tileOf(aim.x), tileOf(aim.y)];
    if (this.solid(at, au)) return false;
    if (zt !== at || zu !== au) {
      const next = this.nextTile(zt, zu, at, au);
      if (!next) return false; // walled off (e.g. closed door)
      gx = next.tx * TILE + TILE / 2;
      gy = next.ty * TILE + TILE / 2;
    }
    const d = dist(gx, gy, c.x, c.y) || 1;
    const step = Math.min(spec.speed * dt, d);
    this.move(z, spec.size, ((gx - c.x) / d) * step, ((gy - c.y) / d) * step);
    return true;
  }

  /** BFS from the target tile; returns the neighbour of (fx,fy) that is closest to it. */
  private nextTile(fx: number, fy: number, tx: number, ty: number): { tx: number; ty: number } | null {
    const d = new Int16Array(COLS * ROWS).fill(-1);
    const queue = [ty * COLS + tx];
    d[queue[0]!] = 0;
    const dirs = [[1, 0], [-1, 0], [0, 1], [0, -1]] as const;
    for (let i = 0; i < queue.length; i++) {
      const cur = queue[i]!;
      const [x, y] = [cur % COLS, Math.floor(cur / COLS)];
      for (const [ox, oy] of dirs) {
        const nx = x + ox;
        const ny = y + oy;
        if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS || this.solid(nx, ny) || d[ny * COLS + nx]! >= 0) continue;
        d[ny * COLS + nx] = d[cur]! + 1;
        queue.push(ny * COLS + nx);
      }
    }
    let best: { tx: number; ty: number } | null = null;
    let bestD = d[fy * COLS + fx]!;
    if (bestD < 0) return null;
    for (const [ox, oy] of dirs) {
      const nx = fx + ox;
      const ny = fy + oy;
      if (nx < 0 || ny < 0 || nx >= COLS || ny >= ROWS) continue;
      const nd = d[ny * COLS + nx]!;
      if (nd >= 0 && nd < bestD) {
        bestD = nd;
        best = { tx: nx, ty: ny };
      }
    }
    return best;
  }

  private combat(alive: PlayerState[], dt: number): void {
    for (const z of this.zombies) {
      const spec = ZOMBIE_TYPES[z.type];
      const c = zc(z);
      const touch = (spec.size + PLAYER_SIZE) / 2; // centre distance when bodies touch
      for (const p of alive) {
        if (!p.alive) continue;
        const pp = pc(p);
        const d = dist(pp.x, pp.y, c.x, c.y);
        if (d <= touch + 12) z.hp -= (p.grouped ? DPS_GROUPED : DPS_ALONE) * dt;
        if (d <= touch + 3 && !p.grouped) {
          p.hp -= spec.dps * dt;
          if (p.hp <= 0) {
            p.hp = 0;
            p.alive = false;
          }
        }
        // Hulks barge players away, which is how they break up a tight group.
        if (z.type === "hulk" && d <= touch + 4 && d > 0) {
          this.move(p, PLAYER_SIZE, ((pp.x - c.x) / d) * SHOVE_SPEED * dt, ((pp.y - c.y) / d) * SHOVE_SPEED * dt);
        }
      }
    }
    this.zombies = this.zombies.filter((z) => z.hp > 0);
  }

  /** Body collision: players and zombies push each other apart (heavier bodies move less). */
  private separate(alive: PlayerState[]): void {
    type Body = { b: Box; size: number; mass: number; c: Pt };
    const bodies = (): Body[] => [
      ...alive.filter((p) => p.alive).map((p) => ({ b: p, size: PLAYER_SIZE, mass: PLAYER_MASS, c: pc(p) })),
      ...this.zombies.map((z) => ({ b: z, size: ZOMBIE_TYPES[z.type].size, mass: ZOMBIE_TYPES[z.type].mass, c: zc(z) })),
    ];
    for (let pass = 0; pass < 2; pass++) {
      const list = bodies();
      for (let i = 0; i < list.length; i++) {
        for (let j = i + 1; j < list.length; j++) {
          const a = list[i]!;
          const b = list[j]!;
          const min = (a.size + b.size) / 2;
          let dx = b.c.x - a.c.x;
          let dy = b.c.y - a.c.y;
          let d = Math.hypot(dx, dy);
          if (d >= min) continue;
          if (d < 0.001) [dx, dy, d] = [1, 0, 1]; // exactly stacked: pick a direction
          const overlap = min - d;
          const share = a.mass + b.mass;
          this.move(a.b, a.size, (-dx / d) * overlap * (b.mass / share), (-dy / d) * overlap * (b.mass / share));
          this.move(b.b, b.size, (dx / d) * overlap * (a.mass / share), (dy / d) * overlap * (a.mass / share));
        }
      }
    }
  }

  // --- world ---------------------------------------------------------------

  private tileUnder(p: PlayerState): string {
    return this.level.at(tileOf(pc(p).x), tileOf(pc(p).y));
  }

  private solid(tx: number, ty: number): boolean {
    const ch = this.level.at(tx, ty);
    return ch === "#" || (isDoor(ch) && !this.openDoors.has(ch));
  }

  private blocked(x: number, y: number, size: number): boolean {
    const e = size - 0.001;
    for (const [px, py] of [[x, y], [x + e, y], [x, y + e], [x + e, y + e]] as const) {
      if (this.solid(tileOf(px), tileOf(py))) return true;
    }
    return false;
  }

  /** Axis-separated movement so entities slide along walls. */
  private move(b: Box, size: number, vx: number, vy: number): void {
    if (!this.blocked(b.x + vx, b.y, size)) b.x += vx;
    if (!this.blocked(b.x, b.y + vy, size)) b.y += vy;
  }

  /** A door opens (and stays open) when every plate linked to it is held at once. */
  private updatePlates(living: PlayerState[]): void {
    this.pressed.clear();
    const tiles = living.map((p) => [tileOf(pc(p).x), tileOf(pc(p).y)]);
    for (const pl of this.level.plates) {
      if (tiles.some(([x, y]) => x === pl.tx && y === pl.ty)) this.pressed.add(`${pl.tx},${pl.ty}`);
    }
    for (const door of new Set(this.level.plates.map((p) => p.door))) {
      const linked = this.level.plates.filter((p) => p.door === door);
      if (linked.every((p) => this.pressed.has(`${p.tx},${p.ty}`))) this.openDoors.add(door);
    }
  }
}
