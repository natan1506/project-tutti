// Disposição da fileira de mascotes e distância de câmera para caber todos na largura
// (a margem cobre os bracinhos da Bússola, que saem da caixa).

export const SPACING = 2.35

export function mascotX(index: number, count: number, spacing = SPACING): number {
  return (index - (count - 1) / 2) * spacing
}

export function fitCameraDistance(count: number, spacing: number, fovDeg: number, aspect: number, margin = 1.2, min = 10): number {
  const need = count * spacing + margin
  const halfFov = (fovDeg * Math.PI) / 360
  return Math.max(need / 2 / (Math.tan(halfFov) * aspect), min)
}

/** Largura máxima do balão em px: menor que o espaço entre dois mascotes, para balões vizinhos nunca se sobreporem. */
export function bubbleMaxWidth(stageWidthPx: number, count: number, spacing = SPACING, margin = 1.2): number {
  const spacingPx = (stageWidthPx * spacing) / (count * spacing + margin)
  return Math.min(200, Math.floor(spacingPx * 0.94))
}
