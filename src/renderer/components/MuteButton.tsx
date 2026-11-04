import { Volume2, VolumeX } from 'lucide-react'
import { useEffect } from 'react'
import { useVoiceStore } from '../state/voiceStore'
import { voicePlayer } from '../state/voiceBridge'

/** 🔊/🔇 no topo: silencia todas as vozes; ficar mudo corta a fala atual (design §6.2). */
export function MuteButton() {
  const muted = useVoiceStore(s => s.muted)
  useEffect(() => { void window.time.voiceMuted().then(m => useVoiceStore.setState({ muted: m })) }, [])
  function toggle() {
    const next = !muted
    useVoiceStore.setState({ muted: next })
    if (next) voicePlayer.mute()
    void window.time.setVoiceMuted(next)
  }
  return (
    <button className="mute" aria-label={muted ? 'Ligar vozes' : 'Silenciar vozes'} title={muted ? 'Vozes desligadas' : 'Vozes ligadas'} onClick={toggle}>
      {muted ? <VolumeX size={16} strokeWidth={1.8} /> : <Volume2 size={16} strokeWidth={1.8} />}
    </button>
  )
}
