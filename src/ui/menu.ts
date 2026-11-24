import { LEVELS } from "../shared/level";
import type { ServerMsg } from "../shared/protocol";
import { COLORS } from "../shared/sim";

type Lobby = Extract<ServerMsg, { t: "lobby" }>;

const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

export interface MenuHandlers {
  create(name: string): void;
  join(code: string, name: string): void;
  start(level: number): void;
}

/** DOM overlay for the main menu and lobby (the canvas only draws the game). */
export class Menu {
  private overlay = $("overlay");
  private menu = $("menu");
  private lobby = $("lobby");
  private select = $<HTMLSelectElement>("level");

  constructor(h: MenuHandlers) {
    const name = () => $<HTMLInputElement>("name").value;
    $("create").onclick = () => h.create(name());
    $("join").onclick = () => h.join($<HTMLInputElement>("code").value, name());
    $("start").onclick = () => h.start(Number(this.select.value));
    LEVELS.forEach((l, i) => this.select.add(new Option(`Level ${i + 1}: ${l.name}`, String(i))));
  }

  showError(msg: string): void {
    $("error").textContent = msg;
  }

  showMenu(): void {
    this.overlay.hidden = false;
    this.menu.hidden = false;
    this.lobby.hidden = true;
  }

  /** Shows the lobby, or hides the overlay while a game is running. */
  update(msg: Lobby, you: string): void {
    const last = msg.level === LEVELS.length - 1;
    this.overlay.hidden = msg.phase === "playing";
    this.menu.hidden = true;
    this.lobby.hidden = false;
    $("room-code").textContent = msg.code;
    $("level-info").textContent = `Level ${msg.level + 1}/${LEVELS.length}: ${LEVELS[msg.level]!.name}`;
    $("hint").textContent = LEVELS[msg.level]!.hint;
    $("result").textContent =
      msg.phase === "won" ? (last ? "All levels cleared! 🎉" : "Level cleared! 🎉") : msg.phase === "lost" ? "Everyone was eaten… 🧟" : "";

    $("players").replaceChildren(
      ...msg.players.map((p) => {
        const li = document.createElement("li");
        const dot = document.createElement("span");
        dot.className = "dot";
        dot.style.background = COLORS[p.slot] ?? "#fff";
        li.append(dot, document.createTextNode(`${p.name}${p.id === you ? " (you)" : ""}${p.id === msg.hostId ? " ★" : ""}`));
        return li;
      }),
    );

    const isHost = msg.hostId === you;
    this.select.hidden = !(isHost && msg.phase === "lobby");
    this.select.value = String(msg.level);
    $("start").hidden = !isHost;
    $("start").textContent = { lobby: "Start", won: last ? "Restart from level 1" : "Next level", lost: "Retry", playing: "" }[msg.phase];
    $("waiting").hidden = isHost;
  }
}
