/** Dubai reporting month, independent of the viewer's device timezone. */
export function businessPeriod(instant = new Date()): string {
  return new Date(instant.getTime() + 4 * 60 * 60 * 1000)
    .toISOString()
    .slice(0, 7);
}
