// Planta do escritório (design §7.2): mesas em duas fileiras, corredor no meio, reunião e café nas pontas.
// Coordenadas no chão (x, z); a câmera olha de cima em diagonal.

export interface Spot { x: number; z: number }

export const DESK_GAP = 3.1
// Fileira de trás mais alta na tela; deslocada meia mesa para ninguém ficar escondido atrás de outro.
export const ROW_Z = [-3.4, 1.6] as const
export const CORRIDOR_Z = -0.9
const MEETING = { x: -7.1, z: -0.8, r: 1.5 }
const COFFEE = { x: 7.3, z: -3.6 }

/** Mesa `i` de `n`: metade em cada fileira, centralizadas. */
export function deskSpot(i: number, n: number): Spot {
  const perRow = Math.ceil(Math.max(n, 1) / 2)
  const row = i < perRow ? 0 : 1
  const col = row === 0 ? i : i - perRow
  const inRow = row === 0 ? perRow : n - perRow
  return { x: (col - (inRow - 1) / 2) * DESK_GAP + (row === 0 && n > 1 ? DESK_GAP / 4 : row === 1 ? -DESK_GAP / 4 : 0), z: ROW_Z[row] }
}

/** Cadeira `i` de `n` em volta da mesa redonda. */
export function meetingSeat(i: number, n: number): Spot {
  const a = (i / Math.max(n, 1)) * Math.PI * 2 + Math.PI / 2
  return { x: MEETING.x + Math.cos(a) * MEETING.r, z: MEETING.z + Math.sin(a) * MEETING.r }
}
export const meetingCenter = (): Spot => ({ x: MEETING.x, z: MEETING.z })
export const coffeeSpot = (): Spot => ({ ...COFFEE, z: COFFEE.z + 1 })
export const coffeeMachine = (): Spot => ({ ...COFFEE })

/** Caminho simples: sai para o corredor, anda por ele e entra no destino (sem colisão). */
export function pathBetween(from: Spot, to: Spot): Spot[] {
  if (from.x === to.x && from.z === to.z) return [from]
  return [from, { x: from.x, z: CORRIDOR_Z }, { x: to.x, z: CORRIDOR_Z }, to]
}
