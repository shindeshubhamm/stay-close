/**
 * Levels, shared by client (rendering) and server (simulation).
 *
 *   #    wall                 .   floor              P  player spawn (need 5)
 *   Z    walker zombie        E   exit tile (all survivors must stand on exits)
 *   R    runner zombie (fast, flanks stragglers)
 *   H    hulk zombie (slow, tanky, shoves players apart)
 *   A-D  pressure plate: the matching lowercase door opens (and stays open)
 *        once ALL plates of that letter are held at the same moment.
 *   a-d  door
 *
 * Every level is 20x11 tiles so the canvas size never changes.
 */
export const TILE = 16;
export const COLS = 20;
export const ROWS = 11;

export const isPlate = (ch: string) => "ABCD".includes(ch);
export const isDoor = (ch: string) => "abcd".includes(ch);

export interface Plate { tx: number; ty: number; door: string }
export type ZombieType = "walker" | "runner" | "hulk";
const ZOMBIE_CHARS: Record<string, ZombieType> = { Z: "walker", R: "runner", H: "hulk" };

export interface Level {
  name: string;
  hint: string;
  /** Seconds between extra zombies arriving (0 = never). Adds time pressure. */
  reinforceEvery: number;
  spawns: { tx: number; ty: number }[];
  plates: Plate[];
  zombies: { tx: number; ty: number; type: ZombieType }[];
  /** Tile character at (tx, ty); out-of-bounds is wall. P and Z read as floor. */
  at(tx: number, ty: number): string;
}

export function parseLevel(name: string, hint: string, rows: string[], reinforceEvery = 0): Level {
  if (rows.length !== ROWS) throw new Error(`${name}: expected ${ROWS} rows, got ${rows.length}`);
  const spawns: Level["spawns"] = [];
  const plates: Plate[] = [];
  const zombies: Level["zombies"] = [];
  rows.forEach((row, ty) => {
    if (row.length !== COLS) throw new Error(`${name}: row ${ty} has ${row.length} chars, expected ${COLS}`);
    [...row].forEach((ch, tx) => {
      if (ch === "P") spawns.push({ tx, ty });
      if (ch in ZOMBIE_CHARS) zombies.push({ tx, ty, type: ZOMBIE_CHARS[ch]! });
      if (isPlate(ch)) plates.push({ tx, ty, door: ch.toLowerCase() });
    });
  });
  if (spawns.length < 5) throw new Error(`${name}: needs 5 spawns`);
  const at = (tx: number, ty: number) => {
    if (tx < 0 || ty < 0 || tx >= COLS || ty >= ROWS) return "#";
    const ch = rows[ty]![tx]!;
    return ch === "P" || ch in ZOMBIE_CHARS ? "." : ch;
  };
  return { name, hint, reinforceEvery, spawns, plates, zombies, at };
}

export const LEVELS: Level[] = [
  parseLevel("First Night", "Zombies hunt anyone who is alone. Stay together to stay safe and to hurt them. Hold both A plates together to open the door.", [
    "####################",
    "#.P..P...#.........#",
    "#...P....#..B...B..#",
    "#.P..P...#.........#",
    "#.A...A..a....B....#",
    "#........#.........#",
    "#........#......Z..#",
    "##############b#####",
    "#...Z.........R....#",
    "#............EEEE..#",
    "####################",
  ]),
  parseLevel("Pressure Points", "The plates are far apart, so whoever holds one is alone. Runners (fast) cut off stragglers. Guard your plate holders.", [
    "####################",
    "#P.P....A#......Z..#",
    "#.P......#.........#",
    "#P.P.....#.........#",
    "#........#.........#",
    "#...Z....a.........#",
    "#........#.........#",
    "#A.......#...R...H.#",
    "#........#.......EE#",
    "#........#.......EE#",
    "####################",
  ], 25),
  parseLevel("Four Corners", "Kill what you can together, then split up and press all four corners at once. Hulks (big, slow) shove your group apart. More zombies keep coming.", [
    "####################",
    "#A............A#####",
    "#.......Z......#####",
    "#.........Z....#####",
    "#..P..P........#.EE#",
    "#...P.......H..a.EE#",
    "#..P..P....Z...#.EE#",
    "#..............#####",
    "#.......R......#####",
    "#A............A#####",
    "####################",
  ], 20),
  parseLevel("Dead Ends", "Three one-tile alcoves, three plates, one door. Zombies arrive every few seconds. Time your dash, then run for the exit.", [
    "####################",
    "###A#####A#####A####",
    "###.#####.#####.####",
    "###.#####.#####.####",
    "#.......Z.......#EE#",
    "#..P..P.........#EE#",
    "#...P......H....aEE#",
    "#..P..P.........#EE#",
    "#.......R.......#EE#",
    "####################",
    "####################",
  ], 14),
  parseLevel("Pillar Dance", "Two plates on opposite sides of a pillar: whoever holds one is alone. Use the loop to kite zombies, and keep an eye on the hulk.", [
    "####################",
    "#..P.PP........#####",
    "#..P..P...Z...R#####",
    "#.....####.....#####",
    "#.....####.....#EEE#",
    "#A....####....AaEEE#",
    "#.....####.....#EEE#",
    "#.....####.....#####",
    "#.......H......#####",
    "#..R........Z..#####",
    "####################",
  ], 12),
  parseLevel("Three Lanes", "Three single-file lanes, each ending in a plate. Collision means you queue up, so fight lane by lane before splitting for the plates.", [
    "####################",
    "#P.P......R.......A#",
    "#.P.################",
    "#P.P################",
    "#........H........A#",
    "#.Z.################",
    "#...################",
    "#...........Z.....A#",
    "#aaa################",
    "#EEEEEEE############",
    "####################",
  ], 10),
];
