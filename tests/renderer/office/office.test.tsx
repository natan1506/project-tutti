// @vitest-environment jsdom
import ReactThreeTestRenderer from '@react-three/test-renderer'
import { describe, expect, it } from 'vitest'
import { AGENTS, type AgentId } from '@shared/agents'
import { emptyChat } from '../../../src/renderer/state/chat'
import { deriveStage, type MascotView } from '../../../src/renderer/stage/derive'
import { OfficeScene } from '../../../src/renderer/stage/office/Office'
import { deskSpot } from '../../../src/renderer/stage/office/layout'

const views = (over: Partial<Record<AgentId, MascotView>> = {}) => ({ ...deriveStage(emptyChat(), 0), ...over }) as Record<AgentId, MascotView>

describe('escritório 3D', () => {
  it('uma mesa e um mascote por agente; mascote começa na própria mesa', async () => {
    const r = await ReactThreeTestRenderer.create(<OfficeScene views={views()} selected="time" onSelect={() => {}} headless agents={AGENTS} />)
    expect(r.scene.findAll(n => n.props.name?.startsWith?.('desk-')).length).toBe(AGENTS.length)
    const forja = r.scene.find(n => n.props.name === 'office-mascot-forja')
    const i = AGENTS.findIndex(a => a.id === 'forja')
    expect(forja.instance.position.x).toBeCloseTo(deskSpot(i, AGENTS.length).x)
  })

  it('telefone toca só na mesa de quem espera', async () => {
    const r = await ReactThreeTestRenderer.create(<OfficeScene views={views({ forja: { pose: 'waiting', label: 'Esperando você' } })} selected="time" onSelect={() => {}} headless agents={AGENTS} />)
    const ringing = r.scene.findAll(n => n.props.name?.startsWith?.('phone-') && n.props.userData?.ringing)
    expect(ringing.map(n => n.props.name)).toEqual(['phone-forja'])
  })
})
