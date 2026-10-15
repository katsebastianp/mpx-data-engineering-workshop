/** Shared teaching timeline for both example jets, in illustrative seconds. */
export const STAGE_ENDS = [1.8, 4, 8, 9.6] as const;

export function stageAtTime(time: number): number {
  const stage = STAGE_ENDS.findIndex(end => time < end);
  return stage < 0 ? 3 : stage;
}

/** Move along the same timeline when playing or seeking; never overshoot. */
export function advanceTime(time: number, target: number, delta: number): number {
  const step = Math.max(0, Math.min(delta, .065));
  return time < target ? Math.min(target, time + step) : Math.max(target, time - step);
}
