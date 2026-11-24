/** Fixed-timestep game loop: deterministic updates, render once per frame. */
export function startLoop(
  update: (dt: number) => void,
  render: () => void,
  step = 1 / 60,
): void {
  let last = performance.now();
  let acc = 0;

  const frame = (now: number) => {
    acc += Math.min((now - last) / 1000, 0.25); // clamp after tab switches
    last = now;
    while (acc >= step) {
      update(step);
      acc -= step;
    }
    render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
}
