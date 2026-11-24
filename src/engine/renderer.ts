import { GLYPH_W, glyph } from "./font";

/**
 * Renders to a fixed low-resolution canvas and scales it up by the largest
 * integer factor that fits the window, keeping pixels crisp.
 */
export class Renderer {
  readonly ctx: CanvasRenderingContext2D;

  constructor(
    readonly canvas: HTMLCanvasElement,
    readonly width: number,
    readonly height: number,
  ) {
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas not supported");
    this.ctx = ctx;
    this.ctx.imageSmoothingEnabled = false;
    window.addEventListener("resize", () => this.resize());
    this.resize();
  }

  private resize(): void {
    const fit = Math.min(window.innerWidth / this.width, window.innerHeight / this.height);
    // Whole-number scaling keeps pixels perfect; on small screens (phones) allow
    // fractional scaling instead of leaving the game tiny.
    const scale = fit >= 2 ? Math.floor(fit) : fit;
    this.canvas.style.width = `${this.width * scale}px`;
    this.canvas.style.height = `${this.height * scale}px`;
  }

  clear(color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(0, 0, this.width, this.height);
  }

  rect(x: number, y: number, w: number, h: number, color: string): void {
    this.ctx.fillStyle = color;
    this.ctx.fillRect(Math.round(x), Math.round(y), w, h);
  }

  line(x1: number, y1: number, x2: number, y2: number, color: string): void {
    const c = this.ctx;
    c.strokeStyle = color;
    c.lineWidth = 1;
    c.beginPath();
    c.moveTo(Math.round(x1) + 0.5, Math.round(y1) + 0.5);
    c.lineTo(Math.round(x2) + 0.5, Math.round(y2) + 0.5);
    c.stroke();
  }

  /** Draws one pixel-font character with its top-left at (x, y). */
  char(ch: string, x: number, y: number, color: string): void {
    this.ctx.fillStyle = color;
    glyph(ch).forEach((on, i) => {
      if (on) this.ctx.fillRect(Math.round(x) + (i % GLYPH_W), Math.round(y) + Math.floor(i / GLYPH_W), 1, 1);
    });
  }

  sprite(img: CanvasImageSource, x: number, y: number): void {
    this.ctx.drawImage(img, Math.round(x), Math.round(y));
  }
}
