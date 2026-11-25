# Stay Close

*Don't wander off.*

A browser-based, pixel-art, co-op zombie escape game for up to **5 players**, each on their own device. Work together to solve each room's puzzle and reach the exit alive.

## How to play

- **Move:** `WASD` or arrow keys on desktop. On a phone, touch anywhere and drag to get a joystick.
- **Attack:** `Space` on desktop, the **ATTACK** button on touch. Short cooldown.
- **Safety in numbers:** a player with an ally nearby is *grouped*. Grouped players can't be bitten — but their swings are **harmless**. A white line links grouped players.
- **To kill, step away:** only a *lone* player's swing damages zombies (a walker takes two swings). A red outline marks someone alone: vulnerable, but deadly. Your swing reaches a little further than a zombie's bite, so timing matters. Step out, strike, get back!
- **Zombies try to split you up:**
  - **Walkers** (green) hunt isolated players and spread out to pressure everyone.
  - **Runners** (yellow, fast) go for stragglers and cut them off from the group.
  - **Hulks** (purple, slow and tanky) ram the middle and shove players apart.
- **Puzzles:** a door opens, and stays open, once *all* pressure plates of its letter are held at the same moment (`A` plates open door `a`, and so on).
- **Win** when every surviving player stands on the green exit tiles. **Lose** if everyone dies.

## Run it

Requires [Bun](https://bun.sh).

```bash
bun install
bun run dev
```

This starts the game server (port 3001) and the Vite dev client (port 5173). Open http://localhost:5173, create a room, and share the 4-letter code with friends.

### Play with friends over the internet

Tunnel the Vite port, e.g. with Cloudflare:

```bash
cloudflared tunnel --url http://localhost:5173
```

`*.trycloudflare.com` hosts are already allowed in `vite.config.ts`. Add your own hostname to `server.allowedHosts` for other tunnels or domains. The WebSocket goes through the same URL, so one tunnel is enough.

### Production build

```bash
bun run build
bun run start      # serves dist/ and the WebSocket on http://localhost:3001 (PORT to change)
```

## Scripts

| Command | What it does |
| --- | --- |
| `bun run dev` | game server + Vite dev client |
| `bun run dev:server` / `dev:client` | run either one alone |
| `bun run build` | typecheck and build the client into `dist/` |
| `bun run start` | run the server (also serves `dist/`) |
| `bun run typecheck` | `tsc --noEmit` |
| `bun test` | simulation tests |

## Project layout

```
index.html           canvas, lobby/menu overlay, styles
server/index.ts      Bun WebSocket server: rooms, lobby, 30 Hz game ticks
src/shared/          code shared by client and server
  level.ts             levels (ASCII maps) and level parsing
  sim.ts               authoritative simulation: movement, collision, zombies, puzzles
  protocol.ts          client <-> server message types
src/engine/          loop, input (keyboard + touch joystick), pixel renderer, pixel font
src/game/game.ts     client rendering of server snapshots
src/net/             WebSocket wrapper
src/ui/menu.ts       lobby UI
```

The server owns the game state. Clients send only their movement direction and render snapshots.

## Adding a level

Add a `parseLevel(name, hint, rows, reinforceEvery)` entry to `LEVELS` in `src/shared/level.ts`. Maps are 20×11 tiles:

| Char | Meaning |
| --- | --- |
| `#` | wall |
| `.` | floor |
| `P` | player spawn (at least 5) |
| `E` | exit tile |
| `A`-`D` / `a`-`d` | pressure plate / its door |
| `Z` `R` `H` | walker / runner / hulk |

`reinforceEvery` is the number of seconds between extra zombies (0 for none). Loading throws if a row has the wrong length or there are fewer than 5 spawns, and `bun test` checks that plates and exits are reachable.

Balance numbers (damage, speeds, HP, group radius) are constants at the top of `src/shared/sim.ts`.
