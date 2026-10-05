/** Hanger transforms, not a cloth solver. Frame-rate independent and bounded. */
export type Spring = { value: number; velocity: number };
export const spring = (value = 0): Spring => ({ value, velocity: 0 });
export function stepSpring(s: Spring, target: number, dt: number, stiffness = 145, damping = 23) {
  const steps = Math.max(1, Math.ceil(dt / (1 / 120)));
  const h = Math.min(dt, .05) / steps;
  for (let n = 0; n < steps; n++) {
    s.velocity += ((target - s.value) * stiffness - s.velocity * damping) * h;
    s.value += s.velocity * h;
  }
  if (Math.abs(target - s.value) < .00005 && Math.abs(s.velocity) < .00005) {
    s.value = target; s.velocity = 0;
  }
  return s.value;
}
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const ease = (t: number) => t * t * (3 - 2 * t);
