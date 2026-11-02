import { useEffect, useState } from 'react'

/** Versão nova publicada no GitHub: o .dmg é baixado na página da release (sem atualização automática). */
export function UpdateBanner() {
  const [update, setUpdate] = useState<{ version: string } | null>(null)
  useEffect(() => {
    void window.time.updateInfo().then(setUpdate)
    return window.time.onUpdate(setUpdate)
  }, [])
  if (!update) return null
  return (
    <div className="update">
      <span>Versão {update.version} disponível</span>
      <button className="link" onClick={() => void window.time.openUpdate()}>Baixar</button>
    </div>
  )
}
