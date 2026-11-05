export type PaceInput = { hidden: boolean; covered: boolean; focused: boolean; active: boolean }

/** Quadros por segundo da cena 3D. Zero: nada a mostrar, então não se gasta GPU. */
export function paceFor({ hidden, covered, focused, active }: PaceInput): number {
  if (hidden || covered) return 0
  if (!focused) return active ? 10 : 4
  return active ? 30 : 15
}
