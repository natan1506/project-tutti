import { AudioLines, Palette, Sparkles, UsersRound, type LucideIcon } from 'lucide-react'
import { useLookStore } from '../state/lookStore'
import { useProfileStore } from '../state/profileStore'
import { useSkillStore } from '../state/skillStore'
import { useVoiceStore } from '../state/voiceStore'
import icon from '../assets/icon.png'

// Barra da esquerda: logo e os atalhos de configuração. O topo fica livre para os botões da janela.

function RailButton({ label, Icon, on, onClick }: { label: string; Icon: LucideIcon; on: boolean; onClick(): void }) {
  return (
    <button className={`rail-btn ${on ? 'on' : ''}`} aria-label={label} aria-pressed={on} title={label} onClick={onClick}>
      <Icon size={18} strokeWidth={1.8} />
    </button>
  )
}

export function Rail() {
  const profilesOpen = useProfileStore(s => s.configOpen)
  const openProfiles = useProfileStore(s => s.openConfig)
  const skillsOpen = useSkillStore(s => s.open)
  const openSkills = useSkillStore(s => s.setOpen)
  const voicesOpen = useVoiceStore(s => s.open)
  const openVoices = useVoiceStore(s => s.setOpen)
  const mascotsOpen = useLookStore(s => s.open)
  const openMascots = useLookStore(s => s.setOpen)
  return (
    <nav className="rail">
      <img className="logo" src={icon} alt="Tutti" />
      <div className="rail-group">
        <RailButton label="Perfis" Icon={UsersRound} on={profilesOpen} onClick={() => openProfiles(true)} />
        <RailButton label="Skills" Icon={Sparkles} on={skillsOpen} onClick={() => openSkills(true)} />
        <RailButton label="Vozes" Icon={AudioLines} on={voicesOpen} onClick={() => openVoices(true)} />
        <RailButton label="Mascotes" Icon={Palette} on={mascotsOpen} onClick={() => openMascots(true)} />
      </div>
    </nav>
  )
}
