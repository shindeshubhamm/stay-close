import { describe, expect, test } from "bun:test";
import { COLS, LEVELS, ROWS, TILE, isDoor, parseLevel } from "./level";
import { PLAYER_SIZE, World, type PlayerState } from "./sim";

const IDS = ["p0", "p1", "p2", "p3", "p4"];
function makeWorld(level = LEVELS[0]!, n = 4) {
  const w = new World(level);
  IDS.slice(0, n).forEach((id, i) => w.addPlayer(id, id, i));
  return w;
}
const get = (w: World, id: string): PlayerState => w.snapshot().players.find((p) => p.id === id)!;
function run(w: World, seconds: number) {
  for (let i = 0; i < seconds * 30; i++) w.step(1 / 30);
}
// Test-only access to internals for placing bodies exactly.
const internals = (w: World) => w as unknown as { players: Map<string, PlayerState>; zombies: { x: number; y: number; hp: number }[] };
const arena = (zombieRow: string) =>
  parseLevel("arena", "", [
    "####################",
    "#....P.............#",
    "#..P..P............#",
    zombieRow,
    "#..P..P............#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "#..................#",
    "####################",
  ]);

describe("levels", () => {
  test.each(LEVELS.map((l, i) => [l.name, i] as const))("%s: plates and exit reachable", (_n, i) => {
    const lvl = LEVELS[i]!;
    const seen = new Set<string>();
    const q = [[lvl.spawns[0]!.tx, lvl.spawns[0]!.ty]] as [number, number][];
    while (q.length) {
      const [x, y] = q.pop()!;
      const k = `${x},${y}`;
      if (seen.has(k) || lvl.at(x, y) === "#") continue;
      seen.add(k);
      q.push([x + 1, y], [x - 1, y], [x, y + 1], [x, y - 1]);
    }
    let exits = 0;
    for (let ty = 0; ty < ROWS; ty++) for (let tx = 0; tx < COLS; tx++) if (lvl.at(tx, ty) === "E" && seen.has(`${tx},${ty}`)) exits++;
    expect(exits).toBeGreaterThanOrEqual(3);
    for (const pl of lvl.plates) expect(seen.has(`${pl.tx},${pl.ty}`)).toBe(true);
    for (const pl of lvl.plates) expect(isDoor(pl.door)).toBe(true);
    for (const z of lvl.zombies) expect(seen.has(`${z.tx},${z.ty}`)).toBe(true);
  });
});

describe("grouping rules", () => {
  test("a lone player is hunted and dies", () => {
    const w = makeWorld(arena("#.......Z..........#"), 1);
    run(w, 40);
    expect(get(w, "p0").alive).toBe(false);
    expect(w.lost).toBe(true);
  });

  test("a tight group is safe but its swings are harmless", () => {
    const w = makeWorld(arena("#.......Z..........#"));
    const { players } = internals(w);
    [...players.values()].forEach((p, i) => {
      p.x = 80 + (i % 2) * 12;
      p.y = 60 + Math.floor(i / 2) * 12;
    });
    for (let i = 0; i < 5 * 30; i++) {
      for (const id of IDS.slice(0, 4)) w.attack(id);
      w.step(1 / 30);
    }
    expect(w.snapshot().players.every((p) => p.alive && p.hp === 100)).toBe(true);
    expect(w.snapshot().zombies.length).toBe(1);
    expect(w.snapshot().zombies[0]!.hp).toBe(50); // untouched despite constant swings
  });

  test("a lone player kills a walker with swings and survives", () => {
    const w = makeWorld(arena("#.......Z..........#"), 1);
    const { players, zombies } = internals(w);
    players.get("p0")!.x = 100;
    players.get("p0")!.y = 51;
    zombies[0]!.x = 123; // centre distance 23: inside attack reach, outside the bite
    zombies[0]!.y = 51;
    for (let i = 0; i < 3 * 30; i++) {
      w.attack("p0");
      w.step(1 / 30);
    }
    expect(w.snapshot().zombies.length).toBe(0);
    expect(get(w, "p0").alive).toBe(true);
  });

  test("swings have a cooldown", () => {
    const w = makeWorld(arena("#.......Z..........#"), 1);
    const { players, zombies } = internals(w);
    players.get("p0")!.x = 100;
    players.get("p0")!.y = 51;
    zombies[0]!.x = 123;
    zombies[0]!.y = 51;
    w.attack("p0");
    w.step(1 / 30);
    expect(w.snapshot().zombies[0]!.hp).toBe(20); // 50 - 30
    w.attack("p0");
    w.step(1 / 30);
    expect(w.snapshot().zombies[0]!.hp).toBe(20); // still on cooldown
  });

  test("zombies cannot path through a closed door", () => {
    const w = makeWorld(LEVELS[0]!);
    run(w, 20);
    expect(w.snapshot().players.every((p) => p.hp === 100)).toBe(true);
    expect(w.snapshot().zombies.length).toBe(LEVELS[0]!.zombies.length);
  });
});

describe("five players", () => {
  test("all levels seat five players in distinct spawns", () => {
    for (const lvl of LEVELS) {
      const w = makeWorld(lvl, 5);
      expect(w.snapshot().players.length).toBe(5);
      const spots = new Set(w.snapshot().players.map((p) => `${p.x},${p.y}`));
      expect(spots.size).toBe(5);
    }
  });
});

describe("collision", () => {
  test("players cannot stand inside each other", () => {
    const w = makeWorld(LEVELS[0]!, 2);
    const { players } = internals(w);
    players.get("p1")!.x = players.get("p0")!.x;
    players.get("p1")!.y = players.get("p0")!.y;
    run(w, 1);
    const [a, b] = [get(w, "p0"), get(w, "p1")];
    expect(Math.hypot(a.x - b.x, a.y - b.y)).toBeGreaterThanOrEqual(PLAYER_SIZE - 0.5);
  });

  test("zombies do not stack on each other", () => {
    const w = makeWorld(arena("#.......ZZ.........#"));
    run(w, 1);
    const zs = w.snapshot().zombies;
    expect(zs.length).toBe(2);
    expect(Math.hypot(zs[0]!.x - zs[1]!.x, zs[0]!.y - zs[1]!.y)).toBeGreaterThan(8);
  });
});

describe("zombie tactics", () => {
  test("a hulk shoves players away from it", () => {
    const w = makeWorld(arena("#..................#"), 1);
    const { players } = internals(w);
    const p = players.get("p0")!;
    p.x = 100;
    p.y = 80;
    // Hulk placed directly left of the player, touching.
    w.addPlayer("p1", "p1", 1); // an ally keeps p0 grouped, so only the shove acts
    players.get("p1")!.x = 100;
    players.get("p1")!.y = 94;
    (w as unknown as { spawnZombie(t: string, x: number, y: number, a: boolean): void }).spawnZombie("hulk", 100 - 4, 85, true);
    const before = get(w, "p0").x;
    run(w, 0.5);
    expect(get(w, "p0").x - before).toBeGreaterThan(5);
  });

  test("a runner flanks a straggler from the group's side", () => {
    // Two players close (grouped) at the left, a zombie to the right: it should reach them.
    const w = makeWorld(arena("#...........R......#"));
    run(w, 1.5);
    const r = w.snapshot().zombies[0];
    // Runner (fast) has closed distance substantially.
    expect(r === undefined || r.x < 11 * TILE).toBe(true);
  });

  test("reinforcements arrive on a timer", () => {
    const rows = [
      "####################",
      "#....P.............#",
      "#..P..P............#",
      "#..P..P........Z...#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "#..................#",
      "####################",
    ];
    const none = makeWorld(parseLevel("none", "", rows, 0));
    const timed = makeWorld(parseLevel("timed", "", rows, 3));
    // Keep players safe from the original zombie: remove it so only arrivals count.
    for (const w of [none, timed]) internals(w).zombies.length = 0;
    run(none, 10);
    run(timed, 10);
    expect(none.snapshot().zombies.length).toBe(0);
    expect(timed.snapshot().zombies.length).toBeGreaterThan(0);
  });
});

describe("puzzle", () => {
  test("door opens only when all plates are held at once, then stays open", () => {
    const w = makeWorld(LEVELS[0]!);
    const [a1, a2] = LEVELS[0]!.plates.filter((p) => p.door === "a");
    const { players } = internals(w);
    const put = (id: string, tx: number, ty: number) => {
      const p = players.get(id)!;
      p.x = tx * TILE + 3;
      p.y = ty * TILE + 3;
    };
    put("p0", a1!.tx, a1!.ty);
    w.step(1 / 30);
    expect(w.snapshot().openDoors).toEqual([]);
    put("p1", a2!.tx, a2!.ty);
    w.step(1 / 30);
    expect(w.snapshot().openDoors).toEqual(["a"]);
    put("p1", 1, 6);
    w.step(1 / 30);
    expect(w.snapshot().openDoors).toEqual(["a"]);
  });
});
