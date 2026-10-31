import { createContext, useContext } from 'react'

// Material de "massinha" dos mascotes; agentes travados (ferramenta indisponível) ficam translúcidos via contexto.

export const DimContext = createContext(false)

export function Clay({ color, roughness = 0.55, ...rest }: { color: string; roughness?: number; vertexColors?: boolean }) {
  const dim = useContext(DimContext)
  return <meshStandardMaterial color={color} roughness={roughness} metalness={0.02} transparent={dim} opacity={dim ? 0.45 : 1} {...rest} />
}

export const INK = '#15121a'

export function Ink() {
  return <Clay color={INK} roughness={0.35} />
}
