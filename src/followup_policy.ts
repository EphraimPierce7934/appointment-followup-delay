export function decideFollowupDueAt(now: Date, delayHours: number): Date {
  return new Date(now.getTime() + delayHours * 60 * 60 * 1_000);
}

export function cronFor(date: Date): string {
  return `${date.getUTCMinutes()} ${date.getUTCHours()} ${date.getUTCDate()} ${date.getUTCMonth() + 1} *`;
}
