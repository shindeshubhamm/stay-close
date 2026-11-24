import { Input } from "./engine/input";
import { startLoop } from "./engine/loop";
import { Renderer } from "./engine/renderer";
import { Game, HEIGHT, WIDTH } from "./game/game";
import { Connection } from "./net/connection";
import { LEVELS } from "./shared/level";
import type { Phase, ServerMsg } from "./shared/protocol";
import { Menu } from "./ui/menu";

const canvas = document.getElementById("game") as HTMLCanvasElement;
const hud = document.getElementById("hud") as HTMLElement;
const renderer = new Renderer(canvas, WIDTH, HEIGHT);

let you = "";
let phase: Phase | null = null;

const conn = new Connection(onMessage, () => {
  menu.showMenu();
  menu.showError("Disconnected from server");
});
const game = new Game(new Input(), (m) => conn.send(m), () => you);
const menu = new Menu({
  create: (name) => conn.send({ t: "create", name }),
  join: (code, name) => conn.send({ t: "join", code, name }),
  start: (level) => conn.send({ t: "start", level }),
});

function onMessage(msg: ServerMsg): void {
  switch (msg.t) {
    case "joined":
      you = msg.you;
      break;
    case "lobby": {
      const level = LEVELS[msg.level]!;
      game.setLevel(level);
      if (msg.phase === "playing" && phase !== "playing") game.reset();
      menu.update(msg, you);
      hud.hidden = msg.phase !== "playing";
      hud.textContent = `Level ${msg.level + 1}: ${level.name}. Stay close to allies. Zombies hunt the ones who wander off.`;
      phase = msg.phase;
      break;
    }
    case "state":
      game.setSnapshot(msg.snap);
      break;
    case "error":
      menu.showError(msg.msg);
      break;
  }
}

startLoop(
  () => game.update(),
  () => game.render(renderer),
);
