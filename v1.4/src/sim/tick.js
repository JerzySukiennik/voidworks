// Voidworks — fixed-step simulation clock: accumulates real time and runs the sim at a constant rate.

import { ECONOMY } from '../config.js';

export function createTicker(step, fn) {
  const dt = step || 1 / ECONOMY.tickRate;
  const maxSteps = ECONOMY.maxSubSteps;
  let acc = 0;
  let steps = 0;
  let elapsed = 0;

  return {
    dt,
    get elapsed() { return elapsed; },
    get lastSteps() { return steps; },
    update(real) {
      acc += real;
      steps = 0;
      while (acc >= dt && steps < maxSteps) {
        acc -= dt;
        steps += 1;
        elapsed += dt;
        fn(dt);
      }
      if (acc > dt * maxSteps) acc = dt * maxSteps;
      return steps;
    },
    reset() { acc = 0; elapsed = 0; },
  };
}
