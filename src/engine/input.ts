/** Tracks keyboard state. Use `isDown` for held keys, `wasPressed` for one-shot presses. */
export class Input {
  private down = new Set<string>();
  private pressed = new Set<string>();

  private touchId: number | null = null;
  private origin = { x: 0, y: 0 };
  private stick = { x: 0, y: 0 };
  private touchAttack = false;

  constructor() {
    this.initTouch();
    const btn = document.getElementById("attack");
    btn?.addEventListener("touchstart", (e) => {
      e.preventDefault();
      this.touchAttack = true;
    }, { passive: false });
    btn?.addEventListener("click", () => { this.touchAttack = true; });
    window.addEventListener("keydown", (e) => {
      if (e.target instanceof HTMLInputElement) return; // typing in the lobby
      if (!this.down.has(e.code)) this.pressed.add(e.code);
      this.down.add(e.code);
      if (e.code.startsWith("Arrow") || e.code === "Space") e.preventDefault();
    });
    window.addEventListener("keyup", (e) => this.down.delete(e.code));
    window.addEventListener("blur", () => this.down.clear());
  }

  /** Movement vector in [-1, 1] from keyboard (WASD/arrows) or the touch joystick. */
  axis(): { x: number; y: number } {
    const key = (a: string, b: string) => Number(this.down.has(a)) - Number(this.down.has(b));
    const kx = key("ArrowRight", "ArrowLeft") || key("KeyD", "KeyA");
    const ky = key("ArrowDown", "ArrowUp") || key("KeyS", "KeyW");
    if (kx || ky) return { x: kx, y: ky };
    return this.stick;
  }

  /** Floating joystick: touch anywhere outside the menus, drag to move. */
  private initTouch(): void {
    const base = document.getElementById("stick");
    const knob = document.getElementById("knob");
    const RADIUS = 48; // px of drag for full speed
    const inMenu = (e: Event) => e.target instanceof Element && e.target.closest("#overlay, #attack");

    const place = (el: HTMLElement | null, x: number, y: number) => {
      if (el) el.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`;
    };
    const end = () => {
      this.touchId = null;
      this.stick = { x: 0, y: 0 };
      if (base) base.hidden = true;
    };

    window.addEventListener("touchstart", (e) => {
      if (inMenu(e) || this.touchId !== null) return;
      e.preventDefault();
      const t = e.changedTouches[0]!;
      this.touchId = t.identifier;
      this.origin = { x: t.clientX, y: t.clientY };
      if (base) base.hidden = false;
      place(base, t.clientX, t.clientY);
      place(knob, 0, 0);
    }, { passive: false });

    window.addEventListener("touchmove", (e) => {
      const t = [...e.changedTouches].find((c) => c.identifier === this.touchId);
      if (!t) return;
      e.preventDefault();
      let dx = t.clientX - this.origin.x;
      let dy = t.clientY - this.origin.y;
      const len = Math.hypot(dx, dy);
      if (len > RADIUS) { dx = (dx / len) * RADIUS; dy = (dy / len) * RADIUS; }
      place(knob, dx, dy);
      // Dead zone, then quantise to 0.1 steps to keep network traffic down.
      const q = (v: number) => (Math.abs(v) < 0.2 ? 0 : Math.round((v / RADIUS) * 10) / 10);
      this.stick = { x: q(dx), y: q(dy) };
    }, { passive: false });

    const finish = (e: TouchEvent) => {
      if ([...e.changedTouches].some((c) => c.identifier === this.touchId)) end();
    };
    window.addEventListener("touchend", finish);
    window.addEventListener("touchcancel", finish);
  }

  /** One-shot attack: Space on desktop, the ATTACK button on touch. */
  attack(): boolean {
    const a = this.pressed.has("Space") || this.touchAttack;
    this.touchAttack = false;
    return a;
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  wasPressed(code: string): boolean {
    return this.pressed.has(code);
  }

  /** Call once per fixed update, after the game has read input. */
  endFrame(): void {
    this.pressed.clear();
  }
}
