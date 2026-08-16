export function getTimerElapsedSeconds(timer: { accumulatedSeconds: number; running: boolean; startedAt?: number }) {
  return timer.accumulatedSeconds + (timer.running && timer.startedAt
    ? Math.max(0, Math.floor((Date.now() - timer.startedAt) / 1000))
    : 0)
}
