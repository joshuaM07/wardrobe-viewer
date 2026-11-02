/** Hanger transforms, not a cloth solver. Frame-rate independent and bounded. */
export type Spring = { value: number; velocity: number };
export const spring = (value = 0): Spring => ({ value, velocity: 0 });
export function stepSpring(s: Spring, target: number, dt: number, stiffness = 145, damping = 23) {
  if (dt <= 0) return s.value;
  // Exact damped oscillator: identical motion at 30/60/120/144 Hz, including
  // irregular frames. Euler substeps change both timing and damping with FPS.
  const offset = s.value - target, halfDamping = damping / 2;
  const discriminant = stiffness - halfDamping * halfDamping;
  let position: number, velocity: number;
  if (Math.abs(discriminant) < 1e-7) {
    const b = s.velocity + halfDamping * offset, decay = Math.exp(-halfDamping * dt);
    position = (offset + b * dt) * decay;
    velocity = (s.velocity - halfDamping * b * dt) * decay;
  } else if (discriminant > 0) {
    const frequency = Math.sqrt(discriminant), decay = Math.exp(-halfDamping * dt);
    const sine = Math.sin(frequency * dt), cosine = Math.cos(frequency * dt);
    position = decay * (offset * cosine + (s.velocity + halfDamping * offset) * sine / frequency);
    velocity = decay * (s.velocity * cosine - (halfDamping * s.velocity + stiffness * offset) * sine / frequency);
  } else {
    const frequency = Math.sqrt(-discriminant);
    const r1 = -halfDamping + frequency, r2 = -halfDamping - frequency;
    const a = (s.velocity - r2 * offset) / (r1 - r2), b = offset - a;
    position = a * Math.exp(r1 * dt) + b * Math.exp(r2 * dt);
    velocity = r1 * a * Math.exp(r1 * dt) + r2 * b * Math.exp(r2 * dt);
  }
  s.value = target + position; s.velocity = velocity;
  if (Math.abs(target - s.value) < .00005 && Math.abs(s.velocity) < .00005) {
    s.value = target; s.velocity = 0;
  }
  return s.value;
}

/** Gesture velocity uses event time, so a paused hold releases without a fling. */
export type DragMotion = { position: number; time: number; velocity: number };
export const dragMotion = (position: number, time: number): DragMotion => ({ position, time, velocity: 0 });
export function sampleDrag(drag: DragMotion, position: number, time: number) {
  const elapsed = time - drag.time;
  if (elapsed <= 0) return;
  const velocity = (position - drag.position) * 1000 / elapsed;
  const blend = 1 - Math.exp(-elapsed / 35);
  drag.velocity += (velocity - drag.velocity) * blend;
  drag.position = position; drag.time = time;
}
export const releaseVelocity = (drag: DragMotion, time: number) =>
  time - drag.time > 80 ? 0 : drag.velocity;
export function stepGlide(velocity: number, dt: number, friction = 5.5) {
  const decay = Math.exp(-friction * dt);
  return { distance: velocity * (1 - decay) / friction, velocity: velocity * decay };
}
export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const ease = (t: number) => t * t * (3 - 2 * t);
