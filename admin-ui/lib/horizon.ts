/** Shared dashboard horizon → date window (SAW053). */

export type HorizonId = 'today' | 'period' | 'next' | string;

/**
 * today  → start of today → +2 days (urgent window)
 * period → start of today → +14 days
 * next   → +14 days → +28 days
 */
export function horizonWindow(horizon: HorizonId): { start: Date; end: Date } {
  const start = new Date();
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);

  if (horizon === 'today') {
    end.setDate(end.getDate() + 2);
  } else if (horizon === 'next') {
    start.setDate(start.getDate() + 14);
    end.setDate(end.getDate() + 28);
  } else {
    // period (default)
    end.setDate(end.getDate() + 14);
  }

  return { start, end };
}
